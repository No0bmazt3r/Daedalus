"""Tools that reach outside — registered always, refused until unlocked.

Everything `registry.EXCLUDED` describes as "deliberately not offered" is
implemented here, because *offered* and *implemented* are different words. Each
tool declares the effect that makes it dangerous, and the runtime gate refuses
it until an operator unlocks that effect in Settings → Agent Tools with a
reason. The project's default is unchanged: all four locked, and a fresh install
behaves exactly as `PROJECT.md` §3 describes.

## Why the tools exist at all if the rules forbid them

Because a rule you have never tested is a belief. The dual-track comparison in
§5 is stronger if "the agent could have searched the web and we measured what
that does to groundedness" is a result rather than an assumption — and weaker if
the capability was never built and the claim rests on nobody having tried.

So: build them, gate them, record the gate's state alongside every run, and keep
the locked default. What must not happen is the capability arriving quietly.

## What the unlock does and does not do

An unlock lifts *the refusal*. It does not relax anything else:

- argument validation still runs, so a path is still checked before it is opened;
- every dispatch still writes a `tool_logs` row with its arguments;
- the containment inside each tool — the workspace root, the SSRF guard, the
  timeouts and the output caps — is unconditional and has no switch.

That last point is the important one. The policy row decides *whether* a tool may
run; it never decides *how far* it may reach.

## An honest limit

`bash` and `python` run as this backend's own user, in a working directory, with
a timeout and a pattern denylist. That is containment, not a sandbox: a denylist
is a list of the ways somebody already thought of. If the boundary needs to be
real rather than careful, run Daedalus in its container, where the process is
confined by something that is not a regular expression.
"""

from __future__ import annotations

from . import execute, orchestration, state, web, workspace  # noqa: F401 — registration

__all__ = ["execute", "orchestration", "state", "web", "workspace"]
