"""Hardware detection for the Forge (Layer 11).

Answers one question: *what can this machine actually run?* Step 1 of the six
in `PROJECT.md` §8.2 — detect RAM, CPU, GPU/VRAM, disk and the Ollama version,
so the model-fit estimate has real numbers to work from instead of assumptions.

## Two rules

1. **Never raise.** A machine with no GPU, no `nvidia-smi`, no Ollama and a
   restricted `/proc` is a completely normal machine. Every probe here is
   independently guarded and reports what it could not determine rather than
   failing the whole call — the same optional-import discipline `vector_store`
   uses for Chroma. A panel that 500s because there is no NVIDIA card is worse
   than useless.
2. **Read-only, and local.** Nothing here touches the plant, and the only
   network call is to Ollama on the configured host — a local API, which is
   what Rule 1 permits. It is given a short timeout so a dead Ollama cannot
   hang the panel.
3. **Never probe inside a request.** `profile()` serves a cached snapshot that
   a background task keeps warm; see the *snapshot cache* section at the foot
   of this module for the three tiers and why they refresh at different rates.
   Opening a panel must not cost a subprocess.

This is a *setup* surface, not a runtime one (Rule 5): the orchestrator must
never call it on the chat path.
"""

from __future__ import annotations

import asyncio
import os
import platform
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from typing import Any

_psutil_error: str | None = None

try:  # psutil is the only hard dependency, but treat it as optional anyway —
    # a detection module that cannot be imported is worse than one that reports
    # "unknown", and this way the endpoint degrades instead of 500ing.
    import psutil
except Exception as exc:  # pragma: no cover - defensive
    psutil = None  # type: ignore[assignment]
    # Kept, because "no RAM figure" and "no RAM figure *because psutil did not
    # install on this distro*" are different problems and only one of them is
    # actionable. A wheel-less Python on an immutable distro (Bluefin, Silverblue)
    # is the common way to land here.
    _psutil_error = f"{exc.__class__.__name__}: {exc}"

GB = 1024**3

# nvidia-smi is asked for exactly these fields, in this order.
_SMI_QUERY = "name,memory.total,memory.used,driver_version"


def _cpu() -> dict[str, Any]:
    """Model name, core counts and current load."""
    info: dict[str, Any] = {
        "model": platform.processor() or platform.machine() or None,
        "arch": platform.machine() or None,
        "cores_physical": None,
        "cores_logical": None,
        "base_clock_mhz": None,
        "load_percent": None,
    }

    # platform.processor() is empty on most Linux builds; /proc has the real name.
    if not info["model"] or info["model"] == info["arch"]:
        try:
            with open("/proc/cpuinfo", encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("model name"):
                        info["model"] = line.split(":", 1)[1].strip()
                        break
        except OSError:
            pass

    if psutil is None:
        # os.cpu_count() knows the logical count without psutil; nothing in the
        # stdlib knows the physical one, so it stays None.
        info["cores_logical"] = os.cpu_count()
        return info

    try:
        info["cores_physical"] = psutil.cpu_count(logical=False)
        info["cores_logical"] = psutil.cpu_count(logical=True)
    except Exception:
        pass
    try:
        freq = psutil.cpu_freq()
        if freq:
            # Named `max` by psutil, but under WSL — and in Windows' own
            # Win32_Processor.MaxClockSpeed — this is the *base* clock, not the
            # turbo ceiling. Task Manager shows the live turbo speed, which is
            # why the two never agree. Named for what it actually is.
            info["base_clock_mhz"] = round(freq.max or freq.current or 0) or None
    except Exception:
        # Not exposed in every container or on every ARM board.
        pass
    try:
        # interval=None returns the load since the last call rather than
        # blocking. The first call after import reads 0.0; that is fine for a
        # panel that refreshes.
        info["load_percent"] = psutil.cpu_percent(interval=None)
    except Exception:
        pass
    return info


def _meminfo() -> dict[str, int]:
    """`/proc/meminfo` as bytes, keyed without the trailing colon.

    Values carrying a `kB` unit are converted; bare counts (`HugePages_Total`)
    are left alone. Empty when there is no procfs — every caller treats a
    missing key as "unknown" rather than zero.
    """
    out: dict[str, int] = {}
    try:
        with open("/proc/meminfo", encoding="utf-8") as fh:
            for line in fh:
                key, sep, rest = line.partition(":")
                if not sep:
                    continue
                parts = rest.split()
                if not parts:
                    continue
                try:
                    value = int(parts[0])
                except ValueError:
                    continue
                out[key.strip()] = value * 1024 if len(parts) > 1 else value
    except OSError:
        pass
    return out


def _memory() -> dict[str, Any]:
    """Total/available RAM and swap, in bytes.

    Three probes, in descending order of detail: psutil, then `/proc/meminfo`,
    then `sysconf`. The fallbacks exist because RAM was the one figure with no
    answer of its own — psutil owned it outright, so a machine where psutil is
    missing or raising reported "—" for memory while CPU and disk, which have
    non-psutil paths, kept working. `source` says which probe answered and
    `error` why a richer one did not, so the panel can explain the gap instead
    of leaving a dash.
    """
    out: dict[str, Any] = {
        "total_bytes": None,
        "available_bytes": None,
        "used_percent": None,
        "swap_total_bytes": None,
        "source": None,
        "error": None,
    }

    if psutil is None:
        out["error"] = f"psutil unavailable ({_psutil_error})" if _psutil_error else "psutil unavailable"
    else:
        try:
            vm = psutil.virtual_memory()
            out["total_bytes"] = vm.total
            # `available`, not `total - used`: it accounts for reclaimable cache,
            # which is what actually determines whether a model will load.
            out["available_bytes"] = vm.available
            out["used_percent"] = vm.percent
            out["source"] = "psutil"
        except Exception as exc:
            # Includes the RuntimeWarning psutil raises for a partial
            # /proc/meminfo when warnings are configured as errors.
            out["error"] = f"psutil.virtual_memory() failed ({exc.__class__.__name__}: {exc})"
        try:
            out["swap_total_bytes"] = psutil.swap_memory().total
        except Exception:
            pass

    if out["total_bytes"] is None or out["swap_total_bytes"] is None:
        mem = _meminfo()
        if out["total_bytes"] is None and mem.get("MemTotal"):
            total = mem["MemTotal"]
            # MemAvailable is kernel 3.14+; the older estimate is what `free`
            # itself falls back to.
            avail = mem.get("MemAvailable")
            if avail is None:
                avail = mem.get("MemFree", 0) + mem.get("Buffers", 0) + mem.get("Cached", 0)
            out["total_bytes"] = total
            out["available_bytes"] = min(avail, total)
            out["used_percent"] = round((total - out["available_bytes"]) / total * 100, 1)
            out["source"] = "/proc/meminfo"
        if out["swap_total_bytes"] is None and "SwapTotal" in mem:
            out["swap_total_bytes"] = mem["SwapTotal"]

    if out["total_bytes"] is None:
        # No procfs at all (macOS, a sandbox that hides it). sysconf knows the
        # page count and nothing else, so this answers total and stops there.
        try:
            pages = os.sysconf("SC_PHYS_PAGES")
            page_size = os.sysconf("SC_PAGE_SIZE")
            if pages > 0 and page_size > 0:
                out["total_bytes"] = pages * page_size
                out["source"] = "sysconf"
        except (AttributeError, ValueError, OSError):
            # sysconf does not exist on Windows and these names are not
            # defined everywhere it does.
            pass

    if out["total_bytes"] is None and not out["error"]:
        out["error"] = "no memory probe answered (psutil, /proc/meminfo and sysconf all silent)"
    return out


def _disk() -> dict[str, Any]:
    """Free space where models and stores actually live.

    Reported for the Ollama model directory rather than `/`: on a machine with
    a small root and a large home, the root figure would be the wrong answer to
    "can I pull a 5GB model".
    """
    target = os.environ.get("OLLAMA_MODELS") or os.path.expanduser("~/.ollama")
    if not os.path.isdir(target):
        target = os.path.expanduser("~")
    out: dict[str, Any] = {"path": target, "total_bytes": None, "free_bytes": None}
    try:
        usage = shutil.disk_usage(target)
        out["total_bytes"] = usage.total
        out["free_bytes"] = usage.free
    except Exception:
        pass
    return out


def _gpus() -> dict[str, Any]:
    """GPUs and their VRAM.

    Tries pynvml first (richer, no subprocess), falls back to `nvidia-smi`, and
    reports an empty list when neither is present. "No GPU" is a supported
    configuration — the production SLM tier is chosen to run on CPU.
    """
    result: dict[str, Any] = {"available": False, "source": None, "devices": [], "error": None}

    try:
        import pynvml  # type: ignore[import-not-found]

        pynvml.nvmlInit()
        try:
            driver = pynvml.nvmlSystemGetDriverVersion()
            if isinstance(driver, bytes):
                driver = driver.decode()
            for i in range(pynvml.nvmlDeviceGetCount()):
                handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                name = pynvml.nvmlDeviceGetName(handle)
                if isinstance(name, bytes):
                    name = name.decode()
                mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
                result["devices"].append({
                    "name": name,
                    "vram_total_bytes": int(mem.total),
                    "vram_used_bytes": int(mem.used),
                    "driver_version": driver,
                })
            result["available"] = bool(result["devices"])
            result["source"] = "pynvml"
            return result
        finally:
            try:
                pynvml.nvmlShutdown()
            except Exception:
                pass
    except Exception:
        # No pynvml, or no NVIDIA driver behind it. Fall through.
        pass

    smi = shutil.which("nvidia-smi")
    if not smi:
        return result
    try:
        proc = subprocess.run(
            [smi, f"--query-gpu={_SMI_QUERY}", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if proc.returncode != 0:
            result["error"] = "nvidia-smi returned an error"
            return result
        for line in proc.stdout.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 4:
                continue
            name, total_mib, used_mib, driver = parts[0], parts[1], parts[2], parts[3]
            result["devices"].append({
                "name": name,
                # nounits gives MiB.
                "vram_total_bytes": int(float(total_mib) * 1024 * 1024),
                "vram_used_bytes": int(float(used_mib) * 1024 * 1024),
                "driver_version": driver,
            })
        result["available"] = bool(result["devices"])
        result["source"] = "nvidia-smi"
    except (subprocess.TimeoutExpired, ValueError, OSError):
        result["error"] = "could not read nvidia-smi output"
    return result


# Host hardware does not change while the process runs, and the interop call
# costs ~2.5s. Probed once, then reused.
_host_machine_cache: dict[str, Any] | None = None
_host_machine_probed = False

_PS_HOST_QUERY = """
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpu = (Get-CimInstance Win32_VideoController).Name
[PSCustomObject]@{
  memory_total_bytes = $cs.TotalPhysicalMemory
  cpu_model = $cpu.Name
  cores_physical = $cpu.NumberOfCores
  cores_logical = $cpu.NumberOfLogicalProcessors
  base_clock_mhz = $cpu.MaxClockSpeed
  gpus = @($gpu)
} | ConvertTo-Json -Compress
"""


def _wsl_host() -> dict[str, Any] | None:
    """The Windows host's totals, when this is running inside WSL.

    Why this exists: under WSL2 the Linux side is a VM with its own slice of the
    machine — by default about half the RAM and a subset of the processors. Every
    figure `psutil` returns is therefore correct *for the VM* and disagrees with
    Task Manager, which is describing the Windows host. Reporting one number
    without saying which machine it belongs to is how a correct reading gets
    mistaken for a broken one.

    Both figures matter, for different reasons: the VM slice is the constraint on
    a model running inside WSL, and the host total is what the machine could give
    it if `.wslconfig` were raised.

    Returns None when not under WSL, when interop is disabled, or when PowerShell
    is unavailable — all normal, none an error.
    """
    global _host_machine_cache, _host_machine_probed
    if _host_machine_probed:
        return _host_machine_cache
    _host_machine_probed = True

    if "microsoft" not in (platform.release() or "").lower():
        return None

    shell = shutil.which("powershell.exe") or shutil.which("pwsh.exe")
    if not shell:
        return None

    try:
        proc = subprocess.run(
            [shell, "-NoProfile", "-NonInteractive", "-Command", _PS_HOST_QUERY],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return None
        import json

        # PowerShell emits CRLF; json is tolerant of the trailing \r but the
        # strings inside are not.
        data = json.loads(proc.stdout.replace("\r", "").strip())
        gpus = data.get("gpus")
        if isinstance(gpus, str):
            gpus = [gpus]
        _host_machine_cache = {
            "memory_total_bytes": data.get("memory_total_bytes"),
            "cpu_model": data.get("cpu_model"),
            "cores_physical": data.get("cores_physical"),
            "cores_logical": data.get("cores_logical"),
            "base_clock_mhz": data.get("base_clock_mhz"),
            "gpus": gpus or [],
        }
    except Exception:
        _host_machine_cache = None
    return _host_machine_cache


def _ollama_is_local() -> bool:
    """Whether an Ollama process is visible in this namespace.

    If it is, inference happens in the same environment these figures describe,
    and the VM slice is the number that decides model fit. Cheap, and the answer
    is what makes the WSL explanation concrete rather than hedged.
    """
    if psutil is None:
        return False
    try:
        for proc in psutil.process_iter(["name"]):
            name = (proc.info.get("name") or "").lower()
            if name.startswith("ollama"):
                return True
    except Exception:
        pass
    return False


def _ollama() -> dict[str, Any]:
    """Whether Ollama is reachable, and which version.

    A local HTTP call, which Rule 1 permits. Short timeout: the panel must
    render promptly whether or not Ollama is running, and "not reachable" is a
    perfectly normal answer during development.
    """
    base = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434").rstrip("/")

    # `host.docker.internal` is how the container reaches the host's Ollama, and
    # it does not resolve when `./daedalus.sh dev` runs the backend on the host
    # itself. Rather than report a false "not reachable" in the mode most of the
    # development happens in, fall back to localhost and say which one answered.
    candidates = [base]
    if "host.docker.internal" in base:
        candidates.append(base.replace("host.docker.internal", "localhost"))

    out: dict[str, Any] = {
        "base_url": base,
        "reachable": False,
        "version": None,
        "resolved_url": None,
    }
    try:
        import httpx
    except Exception:
        return out

    for url in candidates:
        try:
            res = httpx.get(f"{url}/api/version", timeout=2.0)
            if res.status_code == 200:
                out["reachable"] = True
                out["version"] = res.json().get("version")
                out["resolved_url"] = url
                return out
        except Exception:
            continue
    return out


def _host() -> dict[str, Any]:
    return {
        "platform": platform.system() or None,
        "release": platform.release() or None,
        "python": platform.python_version(),
        # WSL reports Linux, which is technically true and practically
        # misleading when reasoning about GPU passthrough.
        "wsl": "microsoft" in (platform.release() or "").lower(),
    }




def _ollama_section() -> dict[str, Any]:
    """Reachability and whether the daemon lives in this namespace, as one probe.

    Kept together because they refresh together: both answers change only when
    somebody starts or stops Ollama, and both are the expensive kind — an HTTP
    call with a timeout, and a walk over every process in /proc.
    """
    out = _ollama()
    out["runs_here"] = _ollama_is_local()
    return out


# ── snapshot cache and background refresh ────────────────────────────────────
#
# Detection used to run inside the request: every time the Forge window or
# Settings → Hardware was opened, this module spawned nvidia-smi, waited out
# Ollama's HTTP timeout and — under WSL — paid ~2.5s for a PowerShell interop
# call, all before the panel could paint. The cost scaled with how often
# somebody looked at the panel, which is the wrong thing for it to scale with.
#
# So the probes now run on a schedule and the endpoint serves the last
# snapshot. Three tiers, because these fields have very different lifetimes and
# very different costs:
#
#   static — CPU model, core counts, architecture, platform, and the Windows
#            host's totals. None of it can change while this process runs, and
#            the WSL probe is by far the most expensive thing here. Probed once.
#   live   — available RAM, CPU load, free disk. The numbers the model-fit
#            estimate is read against, so a stale one is actively misleading
#            rather than merely old. Pure syscalls — the three of them together
#            measure under 2ms — so 30s costs nothing worth counting.
#   slow   — Ollama's reachability and version: an HTTP call with a timeout
#            (2.1s measured when the daemon is down), answering a question whose
#            truth changes when somebody starts or stops it. Five minutes.
#
# The GPU belongs to whichever of the last two its own probe can afford — see
# `_gpu_tier`. With pynvml installed it is a 13ms in-process call and joins the
# live tier; falling back to nvidia-smi it costs 613ms and drops to the slow
# one. Which applies is a property of the machine, not of this file.
#
# `cpu` sits in the live tier although most of it is static: the whole probe is
# a /proc read plus two psutil calls, and splitting it in two to save
# microseconds would cost more in comprehension than it saves in cycles.
#
# The loop also only runs while somebody is watching — IDLE_AFTER seconds with
# no read and it goes dormant, so a machine with the panel closed does no
# detection work at all. That leaves waking up to the read path, which repairs
# a stale live tier itself (a few milliseconds) rather than serving numbers
# from whenever the panel was last open.

# Overridable because the right interval depends on the machine: on a laptop
# with hybrid graphics, each nvidia-smi call can wake the discrete GPU, and
# somebody running the evaluation overnight may want this quieter still.
LIVE_INTERVAL = float(os.environ.get("DAEDALUS_HW_LIVE_INTERVAL", "30"))
SLOW_INTERVAL = float(os.environ.get("DAEDALUS_HW_SLOW_INTERVAL", "300"))
IDLE_AFTER = float(os.environ.get("DAEDALUS_HW_IDLE_AFTER", "120"))

# How often the loop checks whether anything is due. Not itself a probe
# interval: a tick with nothing due costs one comparison per section.
_TICK = 5.0

# Past this the UI stops presenting the numbers as current. Two missed refreshes
# rather than one, so an ordinary scheduling hiccup doesn't cry wolf.
_STALE_AFTER = 2.0


_TIERS: dict[str, float | None] = {
    "static": None,
    "live": LIVE_INTERVAL,
    "slow": SLOW_INTERVAL,
}


class _Section:
    """One probe, the tier that sets its cadence, and its last answer.

    Tier — not a bare interval — because two of them are configurable and could
    be set to the same number, and "refresh the live tier" must keep meaning
    that even when somebody sets the slow one to 30s as well.

    `retier` lets a section pick its own tier from what it just measured. Only
    the GPU needs it, and it needs it because the cost of that probe is not
    knowable up front: see `_gpu_tier`.
    """

    __slots__ = ("probe", "tier", "value", "captured_at", "monotonic_at", "retier")

    def __init__(self, probe: Any, tier: str, retier: Any = None) -> None:
        self.probe = probe
        self.tier = tier
        self.retier = retier
        self.value: Any = None
        self.captured_at: float | None = None  # wall clock, for display
        self.monotonic_at: float = 0.0  # for scheduling — immune to clock changes

    @property
    def interval(self) -> float | None:
        """None for the static tier: probed once, then never again."""
        return _TIERS[self.tier]

    @property
    def probed(self) -> bool:
        return self.captured_at is not None

    def age(self, now: float) -> float | None:
        return None if not self.probed else now - self.monotonic_at

    def due(self, now: float) -> bool:
        if not self.probed:
            return True
        if self.interval is None:
            return False
        return now - self.monotonic_at >= self.interval


def _gpu_tier(value: Any) -> str:
    """Which tier the GPU belongs in — decided by what actually answered.

    The two sources differ in cost by fifty times, and which one is available
    is not knowable until the probe has run: pynvml binds to libnvidia-ml at
    call time, so the same image reports it present on a machine with the
    driver and absent on one without.

    Measured on the development machine (WSL2, RTX 3050): pynvml 13ms,
    nvidia-smi 613ms — the latter being a Windows interop call, not merely a
    subprocess. So VRAM refreshes with the live numbers when it is cheap, and
    falls back to the five-minute tier when it is not. No configuration, and no
    wrong answer on a machine nobody measured.
    """
    if isinstance(value, dict) and value.get("source") == "pynvml":
        return "live"
    return "slow"


def _sections() -> dict[str, _Section]:
    return {
        "host": _Section(_host, "static"),
        # The expensive one: ~2.5s of PowerShell interop, describing a machine
        # that cannot change while this process runs.
        "host_machine": _Section(_wsl_host, "static"),
        "cpu": _Section(_cpu, "live"),
        "memory": _Section(_memory, "live"),
        "disk": _Section(_disk, "live"),
        # Starts slow and re-tiers itself on the first answer — `_gpu_tier` has
        # the measurements. Pessimistic to begin with on purpose: the expensive
        # source is the fallback, so assuming the cheap one and being wrong
        # would put a 613ms probe in the 30-second tier until it corrected.
        "gpu": _Section(_gpus, "slow", retier=_gpu_tier),
        "ollama": _Section(_ollama_section, "slow"),
    }


_state = _sections()

# Held across a refresh so two threads — the loop, and a request that found the
# live tier stale — cannot probe the same section at once. Every holder
# re-checks what is due after acquiring, so the second one usually finds
# nothing left to do and returns immediately.
_refresh_lock = threading.Lock()

# When the profile was last *asked for*. The loop watches this: no readers, no
# work. Starts at boot so the warm-up pass counts as interest.
_last_read_at = time.monotonic()

_background_running = False


def _iso(ts: float | None) -> str | None:
    """Wall-clock seconds as UTC ISO 8601 — the shape every other API here uses."""
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _refresh_section(section: _Section) -> None:
    """Run one probe and record when. Never raises.

    Every probe is already internally guarded, so an exception reaching here is
    a bug rather than an absent GPU — but the loop has to survive it either
    way, and a section that fails keeps its previous value instead of reverting
    to null and blanking the panel.
    """
    try:
        section.value = section.probe()
    except Exception:  # pragma: no cover - defensive
        if not section.probed:
            section.value = None
    if section.retier is not None:
        # Re-read every time, not just the first: a driver that stops answering
        # sends the GPU back to the cheap-to-be-wrong-about tier on its own.
        section.tier = section.retier(section.value)
    section.captured_at = time.time()
    section.monotonic_at = time.monotonic()


def refresh(*, force: bool = False, tier: str | None = None) -> None:
    """Re-probe whatever is due.

    `force` re-runs every probe regardless of tier or schedule — what the
    Re-detect button asks for, and the only way to notice a machine that
    genuinely changed under a long-running process (a GPU passed through,
    `.wslconfig` raised and WSL restarted).

    `tier` limits the pass to one tier. The read path uses `tier="live"`:
    refresh the cheap numbers if they have gone stale, but never make somebody
    opening a panel wait out Ollama's timeout.
    """
    global _host_machine_probed

    if force:
        # The WSL host answer is memoised inside _wsl_host itself; clearing this
        # flag is what makes a forced re-detect actually re-detect.
        _host_machine_probed = False

    with _refresh_lock:
        now = time.monotonic()
        for section in _state.values():
            # A tier filter never suppresses a section's *first* probe: a
            # never-probed section is null, and serving null because the read
            # path only asked for the live tier would be a worse answer than
            # the one probe it costs. After that the filter applies normally.
            if tier is not None and section.tier != tier and section.probed:
                continue
            if force or section.due(now):
                _refresh_section(section)


def _meta(now: float) -> dict[str, Any]:
    """What the UI needs in order to say how current these numbers are.

    A panel that silently serves a cached snapshot is worse than one that
    re-probes on every open: the numbers look live and are not. So the age
    travels with the data and the panel prints it.
    """
    live_ages = [
        age
        for section in _state.values()
        if section.tier == "live" and (age := section.age(now)) is not None
    ]
    # The oldest live section is the honest answer to "how current is this?" —
    # the profile is only as fresh as its least fresh number.
    oldest = max(live_ages) if live_ages else None

    sections: dict[str, Any] = {}
    for name, section in _state.items():
        age = section.age(now)
        sections[name] = {
            "tier": section.tier,
            "captured_at": _iso(section.captured_at),
            "age_seconds": round(age, 1) if age is not None else None,
            "interval_seconds": section.interval,
        }

    return {
        "captured_at": _iso(
            max(
                (s.captured_at for s in _state.values() if s.captured_at is not None),
                default=None,
            )
        ),
        "age_seconds": round(oldest, 1) if oldest is not None else None,
        "stale": oldest is None or oldest > LIVE_INTERVAL * _STALE_AFTER,
        "live_interval_seconds": LIVE_INTERVAL,
        "slow_interval_seconds": SLOW_INTERVAL,
        # False means the loop is dormant or was never started, so these numbers
        # only advance when somebody asks for them. Worth showing: it is the
        # difference between "updating every 30s" and "updated when you looked".
        "background": _background_running,
        "next_refresh_in_seconds": (
            round(max(0.0, LIVE_INTERVAL - oldest), 1) if oldest is not None else 0.0
        ),
        "sections": sections,
    }


def _assemble() -> dict[str, Any]:
    now = time.monotonic()
    return {
        "host": _state["host"].value,
        "cpu": _state["cpu"].value,
        "memory": _state["memory"].value,
        "disk": _state["disk"].value,
        "gpu": _state["gpu"].value,
        "ollama": _state["ollama"].value,
        # None unless this is WSL with interop available. Present so the UI can
        # name which machine every other figure describes.
        "host_machine": _state["host_machine"].value,
        "detector": "psutil" if psutil is not None else "unavailable",
        "refresh": _meta(now),
    }


def profile() -> dict[str, Any]:
    """The full hardware profile, from cache. Never raises.

    Costs nothing in the common case — the background loop has already probed,
    and this assembles a dict. The one exception is the first read after the
    loop has gone dormant, where the live tier is refreshed inline so that
    reopening the panel after lunch shows RAM as it is now, not as it was then.
    That path is syscalls, not subprocesses.
    """
    global _last_read_at
    _last_read_at = time.monotonic()
    refresh(tier="live")
    return _assemble()


def redetect() -> dict[str, Any]:
    """Probe everything now, ignoring the schedule. Backs the Re-detect button.

    Deliberately the slow path: this is the one place that pays for the WSL
    interop call and Ollama's timeout on demand, because somebody asked a
    question the cache cannot answer — *has the machine changed?*
    """
    global _last_read_at
    _last_read_at = time.monotonic()
    refresh(force=True)
    return _assemble()


async def background_refresh() -> None:
    """Keep the snapshot warm while somebody is watching. Runs for the app's life.

    Started from the lifespan in `main.py`. Two things happen here that the
    request path deliberately does not do:

    1. A full probe at boot, off the request path, so the first person to open
       the Forge gets an instant panel instead of paying for the WSL call.
    2. Nothing at all once IDLE_AFTER has passed with no reader. The panel is
       closed almost all of the time; spawning nvidia-smi every 30s on a
       machine nobody is looking at is exactly the waste this replaced.

    Probes are blocking, so each pass goes to a worker thread — the event loop
    must stay free for the chat path, which is the one thing here that is on it.
    """
    global _background_running
    _background_running = True
    try:
        await asyncio.to_thread(refresh)
        while True:
            await asyncio.sleep(_TICK)
            if time.monotonic() - _last_read_at > IDLE_AFTER:
                continue
            await asyncio.to_thread(refresh)
    except asyncio.CancelledError:
        raise
    finally:
        _background_running = False
