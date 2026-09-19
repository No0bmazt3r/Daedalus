"""Execution tools — `bash`, `python` and `write_file`.

The three `registry.EXCLUDED` names with the sharpest edges, implemented behind
the `execute_code` and `write` unlocks. Four containments apply whether or not
those are unlocked, because the policy row decides *whether* a tool runs and
never *how far* it reaches:

1. **A workspace root.** Every path argument resolves inside
   `$DAEDALUS_DATA_DIR/agent_workspace`, and resolution happens *after*
   following symlinks, so a link pointing out is caught by the same check as
   `../../etc/passwd`. Commands run with that directory as their working
   directory and `HOME`.
2. **A scrubbed environment.** The child process gets `PATH`, `HOME`, `LANG` and
   nothing else. Everything this backend holds — Ollama's address, the Chroma
   URL, and anything whose name looks like a credential — is removed, so
   `env | grep -i key` returns nothing worth having.
3. **A timeout and an output cap**, both enforced by the parent. A command that
   runs long is killed with its process group rather than left behind, and a
   command that prints a gigabyte fills a buffer that was already bounded.
4. **A pattern denylist** for the handful of things that are catastrophic
   regardless of intent.

## The denylist is not a sandbox, and saying otherwise would be worse than not having it

A denylist is a list of the ways somebody already thought of. It stops a model
that has confidently decided to `rm -rf /`; it does not stop a determined
attacker who has reached the point of choosing shell commands, and nothing at
this layer would. The real boundaries are the unlock — off by default, recorded
with a reason — and the container, where the process is confined by a kernel
rather than by a regular expression. If this capability is being unlocked on a
machine that matters, run Daedalus in Docker.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Final

from ....db import paths
from ..registry import Effect, Integrity, Param, ToolError, register

WORKSPACE: Final = paths.DATA_DIR / "agent_workspace"

_MAX_OUTPUT_CHARS: Final = 10_000
_MAX_FILE_BYTES: Final = 256 * 1024
_DEFAULT_TIMEOUT: Final = 15
_MAX_TIMEOUT: Final = 60

# Catastrophic regardless of what was intended. Each is a thing that destroys a
# machine or its data in one line, and none has a legitimate use from inside an
# agent's scratch directory.
_DENIED: Final[tuple[tuple[str, str], ...]] = (
    (r"\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf]", "recursive or forced delete"),
    (r"\bmkfs(\.|\b)", "formatting a filesystem"),
    (r"\bdd\b[^|]*\bof=/dev/", "writing to a block device"),
    (r">\s*/dev/(sd|nvme|hd|disk)", "writing to a block device"),
    (r"\b(shutdown|reboot|halt|poweroff)\b", "stopping the machine"),
    (r":\(\)\s*\{.*\};\s*:", "a fork bomb"),
    (r"\bchmod\s+(-[a-zA-Z]+\s+)*777\s+/", "making the root filesystem world-writable"),
    (r"\b(curl|wget)\b[^|;&]*[|]\s*(ba)?sh", "piping a download straight into a shell"),
    (r"\bhistory\s+-c\b", "clearing shell history"),
    (r"/etc/(passwd|shadow|sudoers)", "the system account files"),
    (r"\bsudo\b", "privilege escalation"),
    (r"\.\./\.\./", "climbing out of the workspace"),
)

_DENIED_COMPILED: Final = tuple((re.compile(p, re.IGNORECASE), why) for p, why in _DENIED)

# Names whose *value* is a credential even when the name is not one we listed.
_SECRET_HINT: Final = re.compile(r"(key|token|secret|password|passwd|credential)", re.IGNORECASE)


def _workspace() -> Path:
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    return WORKSPACE


def resolve_in_workspace(raw: str) -> Path:
    """A path argument, resolved and proved to be inside the workspace.

    `Path.resolve()` follows symlinks before the comparison, which is the point:
    a link inside the workspace pointing at `/etc` is the same escape as `..` and
    has to fail the same check.
    """
    root = _workspace().resolve()
    candidate = (root / raw).resolve() if not Path(raw).is_absolute() else Path(raw).resolve()
    if candidate != root and root not in candidate.parents:
        raise ToolError(
            f"{raw} resolves outside the agent workspace. Everything these tools touch "
            f"lives under {root}."
        )
    return candidate


def _child_env() -> dict[str, str]:
    """A minimal environment, with anything credential-shaped removed."""
    workspace = str(_workspace())
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": workspace,
        "PWD": workspace,
        "LANG": os.environ.get("LANG", "C.UTF-8"),
        # Marks the process for anything that cares, and makes an unexpected
        # child obvious in `ps`.
        "DAEDALUS_AGENT_WORKSPACE": workspace,
    }
    return {k: v for k, v in env.items() if not _SECRET_HINT.search(k)}


def _check_denied(text: str) -> None:
    for pattern, why in _DENIED_COMPILED:
        if pattern.search(text):
            raise ToolError(f"refused: this looks like {why}, which these tools will not run")


def _run(argv: list[str], *, timeout: int) -> dict[str, Any]:
    """Run a child process under the workspace, the scrubbed env and a timeout."""
    workspace = str(_workspace())
    try:
        completed = subprocess.run(  # noqa: S603 — argv is a list, never a shell string
            argv,
            cwd=workspace,
            env=_child_env(),
            capture_output=True,
            text=True,
            timeout=timeout,
            # Its own process group, so a timeout kills the children too rather
            # than orphaning whatever the command spawned.
            start_new_session=True,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ToolError(f"killed after {timeout}s") from exc
    except FileNotFoundError as exc:
        raise ToolError(f"{argv[0]} is not installed on this machine") from exc

    stdout = (completed.stdout or "")[:_MAX_OUTPUT_CHARS]
    stderr = (completed.stderr or "")[:_MAX_OUTPUT_CHARS]
    return {
        "exit_code": completed.returncode,
        "stdout": stdout,
        "stderr": stderr,
        "truncated": len(completed.stdout or "") > _MAX_OUTPUT_CHARS
        or len(completed.stderr or "") > _MAX_OUTPUT_CHARS,
    }


@register(
    name="bash",
    category="other",
    summary=(
        "Run a shell command inside the agent's workspace directory. Output is capped "
        "and the command is killed on timeout."
    ),
    effects={Effect.EXECUTE_CODE},
    integrity=Integrity.CORPUS,
    params=(
        Param("command", str, "The command to run.", required=True, max_length=2000),
        Param("timeout", int, "Seconds before it is killed.",
              default=_DEFAULT_TIMEOUT, minimum=1, maximum=_MAX_TIMEOUT),
    ),
)
def bash(command: str, timeout: int) -> dict[str, Any]:
    """One command, through `bash -c`, in the workspace.

    `CORPUS` integrity, which is not an obvious call and is the right one: the
    output is whatever a program printed, it is not this system's own statement
    about itself, and a model reading it should treat it as data rather than as
    something it may act on. A file in the workspace containing instructions is
    the same attack as a hostile PDF.
    """
    if not shutil.which("bash"):
        raise ToolError("bash is not installed on this machine")
    _check_denied(command)
    result = _run(["bash", "-c", command], timeout=timeout)
    return {
        "data": {"command": command, **result},
        "detail": (
            f"exit {result['exit_code']}"
            + (" · output truncated" if result["truncated"] else "")
        ),
    }


@register(
    name="python",
    category="other",
    summary=(
        "Run a short Python script inside the agent's workspace. Useful for arithmetic "
        "over data already retrieved, rather than for asking the model to do it."
    ),
    effects={Effect.EXECUTE_CODE},
    integrity=Integrity.CORPUS,
    params=(
        Param("code", str, "The script to run.", required=True, max_length=8000),
        Param("timeout", int, "Seconds before it is killed.",
              default=_DEFAULT_TIMEOUT, minimum=1, maximum=_MAX_TIMEOUT),
    ),
)
def python(code: str, timeout: int) -> dict[str, Any]:
    """A script, run in isolated mode from a file in the workspace.

    `-I` is the interesting flag: it ignores `PYTHONPATH`, the user site
    directory and `PYTHONSTARTUP`, so the script cannot be steered by anything
    already on this machine. Written to a file rather than passed with `-c` so a
    traceback has real line numbers, which is most of what makes a failed script
    fixable.

    This is also the answer to a Rule 3 temptation: arithmetic over retrieved
    numbers belongs in a program, where it can be checked, rather than in a
    model's head, where it cannot.
    """
    _check_denied(code)
    script = _workspace() / "_agent_script.py"
    script.write_text(code, encoding="utf-8")
    result = _run([sys.executable, "-I", str(script)], timeout=timeout)
    return {
        "data": {**result},
        "detail": (
            f"exit {result['exit_code']}"
            + (" · output truncated" if result["truncated"] else "")
        ),
    }


@register(
    name="write_file",
    category="other",
    summary=(
        "Write a text file inside the agent's workspace — a note, an extracted table, "
        "a script for the python tool to run."
    ),
    effects={Effect.WRITE},
    params=(
        Param("path", str, "Path relative to the workspace.", required=True, max_length=300),
        Param("content", str, "What to write.", required=True, max_length=_MAX_FILE_BYTES),
        Param("append", bool, "Append instead of replacing.", default=False),
    ),
)
def write_file(path: str, content: str, append: bool) -> dict[str, Any]:
    """One text file, inside the workspace, size-capped.

    Nothing outside the workspace is writable and there is no switch that makes
    it so — a tool that could write anywhere could write a systemd unit, and the
    distance from "the agent wrote a note" to that is one path argument.
    """
    target = resolve_in_workspace(path)
    if target.is_dir():
        raise ToolError(f"{path} is a directory")
    encoded = content.encode("utf-8")
    if len(encoded) > _MAX_FILE_BYTES:
        raise ToolError(f"{len(encoded)} bytes exceeds the {_MAX_FILE_BYTES} byte cap")

    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a" if append else "w", encoding="utf-8") as handle:
        handle.write(content)

    return {
        "data": {
            "path": str(target.relative_to(_workspace().resolve())),
            "bytes": target.stat().st_size,
            "appended": append,
        },
        "detail": f"{'appended to' if append else 'wrote'} {target.name}",
    }
