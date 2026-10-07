"""Step 7 of PROJECT.md §7.1: the evidence pack.

Tool envelopes become labelled, citable lines — `[S1]` a sensor reading, `[D1]`
a document passage, `[G1]` a graph node — and the pack keeps
three things the later steps need:

| kept | used by |
|---|---|
| `render()` — the lines, each tool's block fenced by its integrity | step 8, the prompt |
| `numbers` — every quantity the model was actually shown | step 10, the validator |
| `citations()` — what each label points at | step 11, the answer and the UI |

## The model is shown lines, not JSON

A raw envelope is a page of JSON per tool, and an SLM at a 4k context spends
its budget on braces. Each line here carries only what an answer could state —
value, unit, time, mode, source — with the label it must be cited by.
The fence and its integrity hint come from `agent_tools.render_for_prompt`
unchanged, so a document passage is still quoted as data, never as instruction.

## `numbers` is built from the rendered text

Not from the envelopes. A value that exists in a tool result but was not put in
front of the model (the 88 series points left out of the prompt, say) cannot
support a claim, because the model never saw it. Extracting from exactly what
was rendered makes "supported" mean "shown".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .. import agent_tools
from .. import knowledge_graph as kg
from . import numbers, timeparse

RETRIEVAL_TOOLS = ("search_corpus", "graph_walk", "graph_agent", "search_graph")

NO_DOCUMENTS = (
    "NO DOCUMENTS FOUND. The knowledge base returned nothing for this question, so there is no "
    "evidence about procedures, purposes, functions, causes or explanations. Do not describe any "
    "of those from your own knowledge. Say plainly that the documents do not cover it, and answer "
    "only what the readings below show. A reading label such as [S1] supports only the value, "
    "time, mode and flag written on its own line."
)

# A passage long enough to carry a procedure, short enough that five fit.
_PASSAGE_CHARS = 700
# How a passage or node says whose it is. Words the model can repeat, in
# capitals so a small model does not read past them; rule 9 of the prompt says
# what to do with REFERENCE.
_ORIGIN_MARK = {"rig": "[THIS RIG]", "reference": "[REFERENCE: another installation]"}

# Points of a series shown to the model. The tool keeps up to 100.
_SERIES_SHOWN = 12


@dataclass
class EvidenceItem:
    label: str
    #: 'sensor' | 'document' | 'graph'
    kind: str
    tool: str
    line: str
    citation: dict[str, Any]


@dataclass
class EvidencePack:
    items: list[EvidenceItem] = field(default_factory=list)
    #: Per-tool blocks, fenced, in call order.
    blocks: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    numbers: set[float] = field(default_factory=set)
    tools_used: list[str] = field(default_factory=list)
    #: Retrieval ran and returned no passage or node. The prompt says so first,
    #: in capitals, because a small model given only sensor rows will otherwise
    #: explain the reactor from its own training and cite a reading for it.
    no_documents: bool = False

    @property
    def empty(self) -> bool:
        return not self.items

    @property
    def labels(self) -> set[str]:
        return {i.label for i in self.items}

    def render(self) -> str:
        parts = []
        if self.no_documents:
            parts.append(NO_DOCUMENTS)
        parts += self.blocks
        if self.failures:
            parts.append("Tools that did not return evidence:\n" + "\n".join(f"- {f}" for f in self.failures))
        if self.notes:
            parts.append("Notes on how this evidence was gathered:\n" + "\n".join(f"- {n}" for n in self.notes))
        if not self.items:
            parts.append("No evidence was found for this question.")
        return "\n\n".join(parts)

    def citations(self) -> list[dict[str, Any]]:
        # The evidence label last, so nothing in a citation can overwrite it.
        return [{"kind": i.kind, "tool": i.tool, **i.citation, "label": i.label} for i in self.items]

    def as_json(self) -> dict[str, Any]:
        """What the transcript stores beside the answer. Never replayed (§7.4)."""
        return {
            "citations": self.citations(),
            "lines": {i.label: i.line for i in self.items},
            "failures": self.failures,
            "notes": self.notes,
            "tools_used": self.tools_used,
            "no_documents": self.no_documents,
        }


def _when(ts: str | None) -> str:
    """UTC as stored, with the site's wall clock beside it — operators think in the latter."""
    if not ts:
        return "unknown time"
    try:
        at = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return ts
    local = at.astimezone(timeparse.site_tz())
    return f"{at.astimezone(timezone.utc):%Y-%m-%d %H:%M:%S} UTC ({local:%H:%M} site time)"


def _fmt(value: Any, unit: str = "") -> str:
    if value is None:
        return "no value"
    return f"{value} {unit}".strip()


def _age(seconds: int) -> str:
    if seconds < 120:
        return f"{seconds} seconds"
    if seconds < 7200:
        return f"{seconds // 60} minutes"
    if seconds < 172800:
        return f"{seconds // 3600} hours"
    return f"{seconds // 86400} days"


class _Builder:
    def __init__(self) -> None:
        self.pack = EvidencePack()
        self.count: dict[str, int] = {}

    def label(self, prefix: str) -> str:
        self.count[prefix] = self.count.get(prefix, 0) + 1
        return f"{prefix}{self.count[prefix]}"

    def add(self, prefix: str, kind: str, tool: str, line: str, citation: dict[str, Any]) -> str:
        label = self.label(prefix)
        text = f"[{label}] {line}"
        self.pack.items.append(EvidenceItem(label, kind, tool, text, citation))
        return text

    # One method per tool. Each returns the lines for that tool's fenced block.

    def get_live_reading(self, data: dict[str, Any]) -> list[str]:
        if not data.get("found"):
            asked = data.get("requested_timestamp")
            return [f"No {data.get('sensor')} reading" + (f" near {_when(asked)}" if asked else " exists") + "."]
        ts = data.get("timestamp")
        head = f"Reading at {_when(ts)}, mode {data.get('mode')}"
        if data.get("stale"):
            head += f". STALE: this is the newest reading and it is {_age(int(data.get('age_seconds') or 0))} old"
        if data.get("offset_seconds") is not None:
            head += f" (nearest row to the time asked, {abs(int(data['offset_seconds']))} s away)"
        lines = []
        if data.get("sensor") == "all":
            for name, r in (data.get("readings") or {}).items():
                lines.append(self.add("S", "sensor", "get_live_reading", f"{name} = {_fmt(r['value'], r['unit'])}. {head}.",
                                      {"type": "sqlite", "sensor": name, "timestamp": ts, "value": r["value"], "unit": r["unit"]}))
        else:
            lines.append(self.add("S", "sensor", "get_live_reading",
                                  f"{data.get('sensor')} = {_fmt(data.get('value'), data.get('unit', ''))}. {head}.",
                                  {"type": "sqlite", "sensor": data.get("sensor"), "timestamp": ts,
                                   "value": data.get("value"), "unit": data.get("unit")}))
        return lines

    def get_trend(self, data: dict[str, Any]) -> list[str]:
        sensor, unit = data.get("sensor"), data.get("unit", "")
        span = f"{_when(data.get('start_time'))} to {_when(data.get('end_time'))}"
        mode = f", {data['mode_filter']} mode only" if data.get("mode_filter") else ""
        if not data.get("sample_count"):
            return [f"No {sensor} readings from {span}{mode}."]
        s = data.get("summary") or {}
        line = (
            f"{sensor} from {span}{mode}, {s.get('count')} readings: "
            f"{data.get('aggregation')} = {_fmt(data.get('value'), unit)}. "
            f"average {_fmt(s.get('average'), unit)}; min {_fmt(s.get('min'), unit)} at {_when(data.get('min_at'))}; "
            f"max {_fmt(s.get('max'), unit)} at {_when(data.get('max_at'))}; "
            f"first {_fmt(s.get('first'), unit)}; latest {_fmt(s.get('latest'), unit)}."
        )
        lines = [self.add("S", "sensor", "get_trend", line, {
            "type": "sqlite", "sensor": sensor, "aggregation": data.get("aggregation"),
            "value": data.get("value"), "unit": unit, "start_time": data.get("start_time"),
            "end_time": data.get("end_time"), "sample_count": s.get("count"),
        })]
        series = data.get("series") or []
        if series:
            step = max(1, len(series) // _SERIES_SHOWN)
            shown = series[::step][:_SERIES_SHOWN]
            points = ", ".join(f"{p['timestamp'][11:16]} {p['value']}" for p in shown)
            lines.append(f"  (series sample, UTC: {points})")
        return lines

    def search_corpus(self, data: dict[str, Any]) -> list[str]:
        lines = []
        for c in data.get("chunks") or []:
            where = c.get("source_file") or "unknown document"
            if c.get("page_number"):
                where += f" p.{c['page_number']}"
            if c.get("section_title"):
                where += f" §{c['section_title']}"
            text = " ".join(str(c.get("text") or "").split())[:_PASSAGE_CHARS]
            origin = c.get("origin") or "reference"
            lines.append(self.add("D", "document", "search_corpus", f"{where} {_ORIGIN_MARK[origin]}: {text}", {
                "type": "document", "chunk_id": c.get("chunk_id"), "source_file": c.get("source_file"),
                "page_number": c.get("page_number"), "section_title": c.get("section_title"),
                "distance": c.get("distance"), "rerank_score": c.get("rerank_score"), "origin": origin,
            }))
        return lines

    def _node(self, node: dict[str, Any], tool: str) -> str:
        skip = {"id", "type", "label", "aliases", "column", "description", "origin"}
        attrs = "; ".join(f"{k}: {v}" for k, v in node.items() if k not in skip and not isinstance(v, (list, dict)))
        origin = kg.origin_of(node)
        text = f"{node.get('type')} \"{node.get('label')}\""
        # Sensors and modes are the rig's by definition; marking every one would
        # spend tokens saying what the type already says.
        if node.get("type") not in kg.RIG_BY_DEFINITION:
            text += f" {_ORIGIN_MARK[origin]}"
        if node.get("description"):
            text += f": {' '.join(str(node['description']).split())}"
        if attrs:
            text += f" ({attrs})"
        return self.add("G", "graph", tool, text, {"type": "graph", "node_id": node.get("id"),
                                                   "node_type": node.get("type"), "name": node.get("label"),
                                                   "origin": origin})

    def search_graph(self, data: dict[str, Any]) -> list[str]:
        return [self._node(n, "search_graph") for n in data.get("entries") or []]

    def graph_walk(self, data: dict[str, Any]) -> list[str]:
        return [self._node(n, "graph_walk") for n in data.get("nodes") or []]

    def graph_agent(self, data: dict[str, Any]) -> list[str]:
        return [self._node(n, "graph_agent") for n in data.get("nodes") or []]

    def graph_traverse(self, data: dict[str, Any]) -> list[str]:
        seen = {i.citation.get("node_id") for i in self.pack.items if i.kind == "graph"}
        return [self._node(n, "graph_traverse") for n in data.get("nodes") or [] if n.get("id") not in seen]


def build(envelopes: list[dict[str, Any]], *, notes: list[str] | None = None) -> EvidencePack:
    b = _Builder()
    pack = b.pack
    pack.notes.extend(notes or [])
    # Everything the model will read, apart from the fence markers themselves —
    # a nonce like `<<SYSTEM:5e21…>>` is not a quantity anyone should be able to cite.
    shown: list[str] = list(pack.notes)
    for env in envelopes:
        tool = env.get("tool", "?")
        if tool not in pack.tools_used:
            pack.tools_used.append(tool)
        if not env.get("ok"):
            pack.failures.append(f"{tool}: {env.get('detail') or env.get('status')}")
            shown.append(pack.failures[-1])
            continue
        render = getattr(b, tool, None)
        data = env.get("data") or {}
        if render is None or not isinstance(data, dict):
            continue  # a tool the pack has no shape for contributes nothing citable
        lines = render(data)
        if not lines:
            if env.get("detail"):
                pack.notes.append(f"{tool}: {env['detail']}")
                shown.append(pack.notes[-1])
            continue
        shaped = dict(env, data="\n".join(lines))
        pack.blocks.append(agent_tools.render_for_prompt(shaped))
        # Lines without a label (a series sample) and the block header were
        # shown too, so they count.
        shown.extend(lines)
        shown.append(env.get("detail") or "")

    retrieved = any(t in RETRIEVAL_TOOLS for t in pack.tools_used)
    pack.no_documents = retrieved and not any(i.kind in ("document", "graph") for i in pack.items)
    if pack.no_documents:
        shown.append(NO_DOCUMENTS)

    pack.numbers = numbers.values("\n".join(shown))
    return pack
