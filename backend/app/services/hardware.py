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

This is a *setup* surface, not a runtime one (Rule 5): the orchestrator must
never call it on the chat path.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
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


def profile() -> dict[str, Any]:
    """The full hardware profile. Never raises."""
    ollama = _ollama()
    ollama["runs_here"] = _ollama_is_local()
    return {
        "host": _host(),
        "cpu": _cpu(),
        "memory": _memory(),
        "disk": _disk(),
        "gpu": _gpus(),
        "ollama": ollama,
        # None unless this is WSL with interop available. Present so the UI can
        # name which machine every other figure describes.
        "host_machine": _wsl_host(),
        "detector": "psutil" if psutil is not None else "unavailable",
    }
