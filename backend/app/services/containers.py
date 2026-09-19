"""Starting and stopping the optional side-car containers, from the UI.

## The honest warning, first

This talks to the Docker Engine API over a mounted socket. A process that can
reach that socket can do anything Docker can do on the host — start a privileged
container, mount `/`, read any other project's volumes. It is not a limited
permission, and no amount of care *in this file* changes that, because the
limits here bind Daedalus' own code and nothing else on the other side of that
socket.

It matters more here than in most projects, because `agent_tools/extended` ships
`bash` and `python` running **in this same container**, and `execute_code` is
unlocked by default. Socket mounted plus `execute_code` unlocked means an agent
that can run `docker` commands against the host. Pick one:

- leave `DOCKER_SOCKET` unset (the default) and start the container from the
  terminal, which is one command; or
- mount it and lock `execute_code` in Settings → Agent Tools.

The panel says this too. It is not a footnote.

## What it is allowed to touch

An allowlist of container names, checked before every call. Daedalus will start
and stop `daedalus-searxng` and nothing else — not the app, not Chroma, and
certainly not a container belonging to another project on the same machine.
That constrains this module; it does not constrain anything else reaching the
same socket.

## Why stop rather than remove

Removing the container would mean re-creating it, and creating it needs the
image, the entrypoint, the volume and the network — all of which live in
`docker-compose.yml`, where they belong and where this has no business
duplicating them. A stopped container costs nothing and starts in under a
second. The compose file stays the single description of what the container
*is*; this only decides whether it is running.
"""

from __future__ import annotations

import json
import os
from typing import Any, Final

import httpx

# Empty by default. See the module docstring for why this is not a default that
# gets flipped for convenience.
SOCKET_PATH: Final = (os.environ.get("DOCKER_SOCKET") or "").strip()

# Docker's own API version negotiation is not worth the round trip for three
# endpoints; this is old enough to be present everywhere and new enough to have
# what is used here.
_API_VERSION: Final = "v1.41"
_TIMEOUT: Final = 20.0

# The only containers this module will act on, and what each one is for.
MANAGED: Final[dict[str, dict[str, str]]] = {
    "searxng": {
        "container": "daedalus-searxng",
        "label": "SearXNG",
        "purpose": "Self-hosted web search, for sourcing corpus documents.",
        "compose_hint": "./daedalus.sh dev --with-search",
    },
}


class ContainerError(RuntimeError):
    """Docker could not be reached, or refused. Carries a readable reason."""


def available() -> bool:
    """Whether container control actually works, not whether it is configured.

    The distinction is not pedantic. The socket is mounted as root:docker mode
    660 and this container runs as uid 1000, so the file can be present and
    unopenable — which is what happened the first time, reporting the feature
    available and failing on every click. `group_add` in docker-compose.yml is
    the fix; this is the check that would have named it.
    """
    if not SOCKET_PATH or not os.path.exists(SOCKET_PATH):
        return False
    try:
        with httpx.Client(
            transport=httpx.HTTPTransport(uds=SOCKET_PATH),
            base_url=f"http://localhost/{_API_VERSION}",
            timeout=3.0,
        ) as client:
            return client.get("/_ping").status_code < 400
    except (httpx.RequestError, OSError):
        return False


def _client() -> httpx.Client:
    if not SOCKET_PATH:
        raise ContainerError(
            "container control is off. Set DOCKER_SOCKET in .env to enable it — and read "
            "the warning first: it is a host-level privilege, and `execute_code` should be "
            "locked if you turn it on."
        )
    if not os.path.exists(SOCKET_PATH):
        raise ContainerError(f"{SOCKET_PATH} does not exist inside this container")
    # httpx speaks to a unix socket through its transport; no Docker SDK, and no
    # shelling out to the `docker` binary, which would not be present anyway.
    return httpx.Client(
        transport=httpx.HTTPTransport(uds=SOCKET_PATH),
        base_url=f"http://localhost/{_API_VERSION}",
        timeout=_TIMEOUT,
    )


def _resolve(name: str) -> dict[str, str]:
    spec = MANAGED.get(name)
    if spec is None:
        raise ContainerError(
            f"{name!r} is not a container Daedalus manages; expected one of "
            f"{', '.join(MANAGED)}"
        )
    return spec


def _inspect(client: httpx.Client, container: str) -> dict[str, Any] | None:
    """One container by exact name, or None when it has never been created."""
    try:
        response = client.get(
            "/containers/json",
            params={
                "all": "1",
                # Docker's name filter is a substring match, so the exact name is
                # confirmed below rather than trusted from the query.
                "filters": json.dumps({"name": [container]}),
            },
        )
    except httpx.RequestError as exc:
        # EACCES is the one worth naming: the socket is root:docker 660 and this
        # container is uid 1000, so without `group_add` it is present and
        # unopenable — a failure that otherwise reads as "Docker is down".
        hint = (
            " — the socket is mounted but not readable by this container's user. "
            "Set DOCKER_GID in .env to the host's `docker` group id."
            if isinstance(exc.__cause__, PermissionError)
            or "Permission denied" in str(exc)
            else ""
        )
        raise ContainerError(
            f"cannot reach the Docker socket ({exc.__class__.__name__}){hint}"
        ) from exc
    if response.status_code >= 400:
        raise ContainerError(f"Docker returned HTTP {response.status_code}")

    for row in response.json():
        if any(n.lstrip("/") == container for n in row.get("Names") or []):
            return row
    return None


def status(name: str | None = None) -> list[dict[str, Any]]:
    """State of every managed container, or one of them."""
    wanted = [name] if name else list(MANAGED)
    control = available()

    out: list[dict[str, Any]] = []
    for key in wanted:
        spec = _resolve(key)
        row: dict[str, Any] = {
            "name": key,
            "container": spec["container"],
            "label": spec["label"],
            "purpose": spec["purpose"],
            "compose_hint": spec["compose_hint"],
            "control_available": control,
            "exists": False,
            "running": False,
            "state": None,
            "error": None,
        }
        if control:
            try:
                with _client() as client:
                    found = _inspect(client, spec["container"])
                if found:
                    row["exists"] = True
                    row["state"] = found.get("State")
                    row["running"] = found.get("State") == "running"
            except ContainerError as exc:
                row["error"] = str(exc)
        out.append(row)
    return out


def start(name: str) -> dict[str, Any]:
    """Start a stopped managed container.

    Cannot *create* one: that needs the image, entrypoint, volume and network,
    which `docker-compose.yml` already describes. When the container has never
    been created this says so and names the one command that makes it.
    """
    spec = _resolve(name)
    with _client() as client:
        found = _inspect(client, spec["container"])
        if found is None:
            raise ContainerError(
                f"{spec['container']} has never been created. Run `{spec['compose_hint']}` "
                "once — after that it can be started and stopped from here."
            )
        if found.get("State") == "running":
            return {"name": name, "running": True, "detail": f"{spec['label']} is already running"}

        response = client.post(f"/containers/{found['Id']}/start")
        # 304 is Docker's "already started", which is a success with a surprising
        # number attached.
        if response.status_code not in (204, 304):
            raise ContainerError(
                f"could not start {spec['container']}: HTTP {response.status_code}"
            )
    return {"name": name, "running": True, "detail": f"{spec['label']} started"}


def stop(name: str) -> dict[str, Any]:
    """Stop a running managed container. The container is kept, not removed."""
    spec = _resolve(name)
    with _client() as client:
        found = _inspect(client, spec["container"])
        if found is None:
            return {"name": name, "running": False, "detail": f"{spec['label']} is not created"}
        if found.get("State") != "running":
            return {"name": name, "running": False, "detail": f"{spec['label']} is already stopped"}

        response = client.post(f"/containers/{found['Id']}/stop", params={"t": "10"})
        if response.status_code not in (204, 304):
            raise ContainerError(
                f"could not stop {spec['container']}: HTTP {response.status_code}"
            )
    return {"name": name, "running": False, "detail": f"{spec['label']} stopped"}
