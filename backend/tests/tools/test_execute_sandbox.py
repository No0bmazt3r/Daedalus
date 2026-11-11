"""`bash` and `python` run under a kernel sandbox, or not at all."""

from __future__ import annotations

import os
import shutil
import unittest
from pathlib import Path
from unittest import mock

from app.db import paths
from app.tools.agent_tools.extended import execute
from app.tools.agent_tools.registry import ToolError

_which = shutil.which


def _no_bwrap(name: str) -> str | None:
    return None if name == "bwrap" else _which(name)


class NoSandboxTest(unittest.TestCase):
    def test_refused_without_bwrap_or_a_container(self) -> None:
        with mock.patch.object(execute.shutil, "which", side_effect=_no_bwrap), \
                mock.patch.object(execute, "_in_container", return_value=False), \
                mock.patch.dict(os.environ, {"DAEDALUS_ALLOW_UNSANDBOXED_EXEC": ""}), \
                self.assertRaises(ToolError) as caught:
            execute.bash("echo hi", 5)
        self.assertIn("bubblewrap", str(caught.exception))

    def test_the_explicit_opt_out_still_runs_contained(self) -> None:
        with mock.patch.object(execute.shutil, "which", side_effect=_no_bwrap), \
                mock.patch.object(execute, "_in_container", return_value=False), \
                mock.patch.dict(os.environ, {"DAEDALUS_ALLOW_UNSANDBOXED_EXEC": "1"}):
            out = execute.bash("echo hi", 5)["data"]
        self.assertEqual(out["stdout"].strip(), "hi")


@unittest.skipUnless(shutil.which("bwrap"), "bubblewrap not installed")
class BwrapTest(unittest.TestCase):
    def test_workspace_writable_everything_else_hidden_or_read_only(self) -> None:
        secret = paths.CONFIG_DIR / "sandbox-probe.txt"
        secret.write_text("not for the agent", encoding="utf-8")
        out = execute.bash(
            f"echo ok > note.txt && cat note.txt; cat {secret} 2>&1; touch /usr/x 2>&1; ls {Path.home()} | wc -l",
            10,
        )["data"]
        lines = out["stdout"].splitlines()
        self.assertEqual(lines[0], "ok")
        self.assertNotIn("not for the agent", out["stdout"])
        self.assertIn("Read-only", out["stdout"])

    def test_no_network(self) -> None:
        code = "import socket\ntry:\n    socket.create_connection(('1.1.1.1', 53), 2)\n    print('open')\nexcept OSError:\n    print('closed')"
        self.assertEqual(execute.python(code, 10)["data"]["stdout"].strip(), "closed")

    def test_memory_is_capped(self) -> None:
        out = execute.python("b = bytearray(2 << 30)\nprint('allocated')", 10)["data"]
        self.assertNotIn("allocated", out["stdout"])
        self.assertIn("MemoryError", out["stderr"])


if __name__ == "__main__":
    unittest.main()
