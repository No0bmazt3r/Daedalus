"""Generate the README's SVGs:

- banner.svg    animated terminal boot: a block labyrinth, Ariadne's thread,
                DAEDALUS in ANSI Shadow, then boot checks
- architecture.svg  a packet carries one real question through every component
- retrieval.svg     track 1 and track 2 searching the knowledge base, side by side
- forge.svg, ingest.svg  the forge's model flow and blueprints' corpus build
- ttft.svg      time to first token, benchmark vs live chat   } read from
- phases.svg    where an answer's time goes                    } logs/ai_logs.db

    python3 .github/readme/build.py
"""
import random
import sqlite3
import statistics
import sys
from pathlib import Path

# The glyphs and the labyrinth are shared with the terminal banner, so the README
# and `./daedalus.sh` always draw the same maze.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from banner import GLYPHS, maze as _maze  # noqa: E402

WORD = "DAEDALUS"
CMD = "./daedalus.sh"
BOOT = [  # (status, text) printed after the banner
    ("ok", "sensor db opened read-only (mode=ro)"),
    ("ok", "ollama · local model by default, cloud is opt-in"),
    ("ok", "track 1 vector rag · track 2 agentic graphrag"),
    ("ok", "33 deterministic tools · 0 write paths to the plant"),
]

W = 860
BG, BAR = "#0d1117", "#161b22"
GREEN, SHADOW, DIM, THREAD = "#3fb950", "#1f6f2b", "#8b949e", "#ff7b72"
CW, CH = 9, 17                    # one ANSI Shadow character cell
MAZE_N, MC = 7, 7                 # labyrinth: 7×7 rooms, 7px blocks → 15×15 grid
CHAR = 9.6                        # monospace 16px advance; textLength pins it
FONT = 'font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"'

# box-drawing char -> line segments in cell units (0..1), centre is 0.5
SEG = {
    "═": [(0, .5, 1, .5)], "║": [(.5, 0, .5, 1)],
    "╗": [(0, .5, .5, .5), (.5, .5, .5, 1)], "╔": [(.5, .5, 1, .5), (.5, .5, .5, 1)],
    "╝": [(0, .5, .5, .5), (.5, .5, .5, 0)], "╚": [(.5, .5, 1, .5), (.5, .5, .5, 0)],
}


def maze():
    return _maze(MAZE_N, 7)


def text(x, y, body, fill, length, extra=""):
    return (f'<text x="{x}" y="{y}" {FONT} font-size="16" fill="{fill}" xml:space="preserve" '
            f'textLength="{length * CHAR:.1f}" lengthAdjust="spacingAndGlyphs" {extra}>{body}</text>')


def appear(begin, dur=0.01):
    return f'<animate attributeName="opacity" from="0" to="1" begin="{begin:.2f}s" dur="{dur}s" fill="freeze"/>'


def typed(x, y, s, cmd, begin, step, hide_at=None):
    """A command revealed one character at a time, with a block cursor riding it."""
    end = begin + len(cmd) * step
    cid = f"t{int(begin * 100)}"
    xs = ";".join(f"{i * CHAR:.1f}" for i in range(len(cmd) + 1))
    s.append(f'<clipPath id="{cid}"><rect x="{x}" y="{y - 20}" height="30" width="0">'
             f'<animate attributeName="width" values="{xs}" calcMode="discrete" begin="{begin:.2f}s" '
             f'dur="{end - begin:.2f}s" fill="freeze"/></rect></clipPath>')
    s.append(text(x, y, cmd, GREEN, len(cmd), f'clip-path="url(#{cid})"'))
    cx = ";".join(f"{x + i * CHAR:.1f}" for i in range(len(cmd) + 1))
    s.append(f'<rect y="{y - 14}" width="9" height="18" fill="{GREEN}" x="{x}">'
             f'<animate attributeName="x" values="{cx}" calcMode="discrete" begin="{begin:.2f}s" '
             f'dur="{end - begin:.2f}s" fill="freeze"/>'
             '<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;.5;.5;1" dur="1s" '
             'repeatCount="indefinite"/>'
             + (f'<set attributeName="opacity" to="0" begin="{hide_at(end):.2f}s"/>' if hide_at else '')
             + '</rect>')
    return end


def build():
    wall, route = maze()
    g = len(wall)
    maze_px = g * MC
    word_cols = sum(len(GLYPHS[c][0]) for c in WORD)
    gap = 36
    x0 = (W - (maze_px + gap + word_cols * CW)) // 2
    art_y = 92
    boot_y = art_y + maze_px + 40
    end_y = boot_y + len(BOOT) * 22 + 14
    H = end_y + 26

    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
         'role="img" aria-label="Daedalus: a labyrinth and the word DAEDALUS printed in a terminal, '
         'followed by boot checks — read-only sensor db, local Ollama model, two retrieval tracks, '
         '33 deterministic tools">',
         '<defs><filter id="glow" x="-10%" y="-10%" width="120%" height="120%">'
         '<feGaussianBlur stdDeviation="2.2" result="b"/>'
         '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
         '<pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse">'
         '<rect width="4" height="1" fill="#000" opacity=".28"/></pattern></defs>',
         f'<rect width="{W}" height="{H}" rx="10" fill="{BG}"/>',
         f'<path d="M0 10a10 10 0 0 1 10-10h{W - 20}a10 10 0 0 1 10 10v20H0z" fill="{BAR}"/>']
    s += [f'<circle cx="{20 + i * 18}" cy="15" r="5.5" fill="{c}"/>'
          for i, c in enumerate(["#ff5f57", "#febc2e", "#28c840"])]
    s.append(f'<text x="{W // 2}" y="19" fill="{DIM}" {FONT} font-size="12" '
             'text-anchor="middle">daedalus — bash — 80×24</text>')

    prompt = "you@daedalus:~$ "
    s.append(text(24, 62, prompt, DIM, len(prompt)))
    # the first cursor rides the typing, then hands over to the idle prompt below
    t = typed(24 + len(prompt) * CHAR, 62, s, CMD, 0.4, 0.07, hide_at=lambda end: end + 0.2)

    # labyrinth, printed one row of blocks at a time
    s.append('<g filter="url(#glow)">')
    row_t = t + 0.25
    for r in range(g):
        s.append(f'<g opacity="0">{appear(row_t + r * 0.045)}')
        s += [f'<rect x="{x0 + c * MC}" y="{art_y + r * MC}" width="{MC}" height="{MC}" fill="{GREEN}"/>'
              for c in range(g) if wall[r][c]]
        s.append('</g>')
    maze_done = row_t + g * 0.045

    # Ariadne's thread, from the opening to the centre
    pts = [(x0 + c * MC + MC / 2, art_y + r * MC + MC / 2) for c, r in route]
    pts[0] = (pts[0][0], art_y + maze_px + 6)
    length = sum(abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in zip(pts, pts[1:]))
    poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    s.append(f'<polyline points="{poly}" fill="none" stroke="{THREAD}" stroke-width="2.2" '
             f'stroke-linecap="square" stroke-linejoin="miter" stroke-dasharray="{length:.1f}" '
             f'stroke-dashoffset="{length:.1f}"><animate attributeName="stroke-dashoffset" '
             f'from="{length:.1f}" to="0" begin="{maze_done + 0.1:.2f}s" dur="1.6s" fill="freeze"/></polyline>')
    gx, gy = pts[-1]
    thread_done = maze_done + 1.7
    s.append(f'<rect x="{gx - 3.5}" y="{gy - 3.5}" width="7" height="7" fill="{THREAD}" opacity="0">'
             f'{appear(thread_done)}<animate attributeName="opacity" values="1;.25;1" dur="1.4s" '
             f'begin="{thread_done + 0.3:.2f}s" repeatCount="indefinite"/></rect>')

    # DAEDALUS, letters dropping in
    x = x0 + maze_px + gap
    word_y = art_y + (maze_px - 6 * CH) // 2
    for i, ch in enumerate(WORD):
        b = row_t + 0.15 + i * 0.1
        s.append(f'<g opacity="0">{appear(b, 0.2)}<animateTransform attributeName="transform" '
                 f'type="translate" from="0 -14" to="0 0" begin="{b:.2f}s" dur="0.25s" fill="freeze"/>')
        for r, row in enumerate(GLYPHS[ch]):
            for c, gl in enumerate(row):
                px, py = x + c * CW, word_y + r * CH
                if gl == "█":
                    s.append(f'<rect x="{px}" y="{py}" width="{CW}" height="{CH}" fill="{GREEN}"/>')
                for a, bb, cc, d in SEG.get(gl, []):
                    s.append(f'<line x1="{px + a * CW}" y1="{py + bb * CH}" x2="{px + cc * CW}" '
                             f'y2="{py + d * CH}" stroke="{SHADOW}" stroke-width="2"/>')
        s.append('</g>')
        x += len(GLYPHS[ch][0]) * CW
    s.append('</g>')

    # boot checks
    bt = maze_done + 0.5
    for i, (status, line) in enumerate(BOOT):
        y = boot_y + i * 22
        s.append(f'<g opacity="0">{appear(bt + i * 0.35)}')
        s.append(text(24, y, "[    ]", DIM, 6))
        s.append(text(24 + CHAR, y, f" {status} ", GREEN, 4))
        s.append(text(24 + 7 * CHAR, y, line, "#c9d1d9", len(line)))
        s.append('</g>')

    # back to an idle prompt
    idle = bt + len(BOOT) * 0.35 + 0.2
    s.append(f'<g opacity="0">{appear(idle)}{text(24, end_y, prompt, DIM, len(prompt))}'
             f'<rect x="{24 + len(prompt) * CHAR:.1f}" y="{end_y - 14}" width="9" height="18" fill="{GREEN}">'
             '<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;.5;.5;1" dur="1s" '
             'repeatCount="indefinite"/></rect></g>')

    s.append(f'<rect y="30" width="{W}" height="{H - 30}" fill="url(#scan)" pointer-events="none"/>')
    s.append('</svg>')
    Path(__file__).with_name("banner.svg").write_text("\n".join(s) + "\n", encoding="utf-8")


# ── pixel theme (animations + charts) ────────────────────────────────────────
# Redstone circuit: blocks with a bevel, a lamp per block, dust lines that power
# up as the signal passes. Text is Monocraft, the dashboard's own default face,
# embedded so GitHub renders it (SIL OFL 1.1, frontend/src/assets/fonts/).
import base64

ROOT = Path(__file__).resolve().parents[2]
_FONT = base64.b64encode((ROOT / "frontend/src/assets/fonts/Monocraft-Regular.woff2").read_bytes()).decode()
PF = 'font-family="Monocraft, ui-monospace, monospace"'

STONE, STONE_HI, STONE_LO, OUTLINE = "#3b3b43", "#54545e", "#28282e", "#0d0d10"
DEEP = ["#1b1b20", "#1f1f25", "#18181c", "#1d1d22"]
INK, INK2 = "#ececf0", "#a9a9b5"
DUST_OFF, DUST_ON, SIGNAL = "#4a1010", "#ff2b1c", "#ff6a5c"
LAMP_OFF, LAMP_OFF2, LAMP_ON, LAMP_CORE = "#4b3420", "#33231a", "#ffc94a", "#fff3b8"
SPEED, HOLD = 360, 1.15                    # px/s along dust; seconds parked on a block


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def card(w, h, title, heading):
    rng = random.Random(11)
    tile = "".join(f'<rect x="{x * 4}" y="{y * 4}" width="4" height="4" fill="{rng.choice(DEEP)}"/>'
                   for y in range(6) for x in range(6))
    return [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'shape-rendering="crispEdges" role="img" aria-label="{esc(title)}">',
            f'<defs><style>@font-face{{font-family:Monocraft;src:url(data:font/woff2;base64,{_FONT}) format("woff2")}}</style>'
            f'<pattern id="deep" width="24" height="24" patternUnits="userSpaceOnUse">{tile}</pattern>'
            '<filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2.5" result="b"/>'
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>',
            f'<rect width="{w}" height="{h}" fill="url(#deep)"/>',
            f'<rect width="{w}" height="30" fill="#111114"/><rect y="30" width="{w}" height="2" fill="{STONE_LO}"/>',
            f'<text x="16" y="20" {PF} font-size="12" fill="{INK2}">{esc(heading)}</text>']


def window(on, off, cycle):
    """Discrete opacity: hidden, shown from `on` to `off`, hidden again; loops."""
    return (f'<animate attributeName="opacity" values="0;1;0" calcMode="discrete" '
            f'keyTimes="0;{on / cycle:.4f};{off / cycle:.4f}" dur="{cycle:.2f}s" repeatCount="indefinite"/>')


def block(x, y, w, h, face=STONE):
    """A bevelled pixel block: outline, light top-left edge, dark bottom-right edge."""
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{OUTLINE}"/>'
            f'<rect x="{x + 2}" y="{y + 2}" width="{w - 4}" height="{h - 4}" fill="{face}"/>'
            f'<rect x="{x + 2}" y="{y + 2}" width="{w - 4}" height="2" fill="{STONE_HI}"/>'
            f'<rect x="{x + 2}" y="{y + 2}" width="2" height="{h - 4}" fill="{STONE_HI}"/>'
            f'<rect x="{x + 2}" y="{y + h - 4}" width="{w - 4}" height="2" fill="{STONE_LO}"/>'
            f'<rect x="{x + w - 4}" y="{y + 2}" width="2" height="{h - 4}" fill="{STONE_LO}"/>')


def lamp(x, y, on=None, off=None, cycle=None, bad=False):
    """A 16px lamp: dim grid when off, glowing core when lit (between on and off)."""
    s = (f'<rect x="{x}" y="{y}" width="16" height="16" fill="{OUTLINE}"/>'
         f'<rect x="{x + 2}" y="{y + 2}" width="12" height="12" fill="{LAMP_OFF}"/>'
         f'<rect x="{x + 7}" y="{y + 2}" width="2" height="12" fill="{LAMP_OFF2}"/>'
         f'<rect x="{x + 2}" y="{y + 7}" width="12" height="2" fill="{LAMP_OFF2}"/>')
    if bad:
        return s + (f'<rect x="{x + 2}" y="{y + 2}" width="12" height="12" fill="#a3201a"/>'
                    f'<path d="M{x + 4} {y + 4}l8 8m0 -8l-8 8" stroke="#ffd2cc" stroke-width="2"/>')
    if on is None:
        return s
    return s + (f'<g opacity="0" filter="url(#glow)">{window(on, off, cycle)}'
                f'<rect x="{x + 2}" y="{y + 2}" width="12" height="12" fill="{LAMP_ON}"/>'
                f'<rect x="{x + 5}" y="{y + 5}" width="6" height="6" fill="{LAMP_CORE}"/></g>')


class Flow:
    """Blocks joined by redstone dust; a signal runs a route, lamps light as it arrives,
    and a chat line narrates the real value at each stop."""

    def __init__(self, w, h, title, heading, bw=186, bh=40):
        self.w, self.h, self.bw, self.bh = w, h, bw, bh
        self.s = card(w, h, title, heading)
        self.nodes, self.edges = {}, {}

    def box(self, key, x, y, name, sub, tone=None):
        self.nodes[key] = (x, y, name, sub, tone)

    def c(self, k):
        x, y, *_ = self.nodes[k]
        return x + self.bw / 2, y + self.bh / 2

    def edge(self, a, b, pts=None, tone=None):
        if pts is None:
            (ax, ay, *_), (bx, by, *_) = self.nodes[a], self.nodes[b]
            (acx, acy), (bcx, bcy) = self.c(a), self.c(b)
            if ay == by:
                pts = [(ax + self.bw, acy), (bx, bcy)] if bx > ax else [(ax, acy), (bx + self.bw, bcy)]
            elif ax == bx:
                pts = [(acx, ay + self.bh), (bcx, by)] if by > ay else [(acx, ay), (bcx, by + self.bh)]
            else:
                mx = (ax + self.bw + bx) / 2
                pts = [(ax + self.bw, acy), (mx, acy), (mx, bcy), (bx, bcy)]
        self.edges[(a, b)] = (pts, tone)

    def render(self, route, captions, cap_y, who="daedalus"):
        s = self.s
        for (pts, tone) in self.edges.values():
            dash = ' stroke-dasharray="4 4"' if tone == "bad" else ""
            s.append(f'<polyline points="{" ".join(f"{x:.0f},{y:.0f}" for x, y in pts)}" fill="none" '
                     f'stroke="{DUST_OFF}" stroke-width="4" stroke-linejoin="miter"{dash}/>')
        path, t, length, stops = [], 0.6, 0.0, []
        for i, k in enumerate(route):
            if i == 0:
                path.append(self.c(k))
            else:
                seg = [path[-1], *self.edges[(route[i - 1], k)][0], self.c(k)]
                d = sum(abs(q[0] - p[0]) + abs(q[1] - p[1]) for p, q in zip(seg, seg[1:]))
                length += d
                path += seg[1:]
                t += max(0.35, d / SPEED)
            stops.append((t, length))
            t += HOLD
        cycle = t + 1.6
        d = "M" + " L".join(f"{x:.0f} {y:.0f}" for x, y in path)
        kt, kv, kp = ["0"], [f"{length:.1f}"], ["0"]
        for (a, l) in stops:
            kt += [f"{a / cycle:.4f}", f"{min(a + HOLD, cycle - 1) / cycle:.4f}"]
            kv += [f"{length - l:.1f}"] * 2
            kp += [f"{l / length:.4f}"] * 2
        kt.append("1"); kv.append("0"); kp.append("1")
        # dust powers up behind the signal
        s.append(f'<path d="{d}" fill="none" stroke="{DUST_ON}" stroke-width="4" filter="url(#glow)" '
                 f'stroke-dasharray="{length:.1f}" stroke-dashoffset="{length:.1f}">'
                 f'<animate attributeName="stroke-dashoffset" values="{";".join(kv)}" keyTimes="{";".join(kt)}" '
                 f'dur="{cycle:.2f}s" repeatCount="indefinite"/>{window(0.01, cycle - 0.6, cycle)}</path>')
        arrive = {k: stops[i][0] for i, k in enumerate(route)}
        for k, (x, y, name, sub, tone) in self.nodes.items():
            bad = tone == "bad"
            s.append(block(x, y, self.bw, self.bh, "#4a2424" if bad else STONE))
            if k in arrive:
                s.append(f'<rect x="{x}" y="{y}" width="{self.bw}" height="{self.bh}" fill="none" '
                         f'stroke="{LAMP_ON}" stroke-width="2" opacity="0">{window(arrive[k], cycle - 0.6, cycle)}</rect>')
            s.append(lamp(x + self.bw - 24, y + 12, *((arrive[k], cycle - 0.6, cycle) if k in arrive else ()), bad=bad))
            s.append(f'<text x="{x + 10}" y="{y + 18}" {PF} font-size="12" fill="{"#ffb4ab" if bad else INK}">{esc(name)}</text>')
            s.append(f'<text x="{x + 10}" y="{y + 32}" {PF} font-size="9" fill="{INK2}">{esc(sub)}</text>')
        motion = (f'<animateMotion path="{d}" keyPoints="{";".join(kp)}" keyTimes="{";".join(kt)}" '
                  f'calcMode="linear" dur="{cycle:.2f}s" repeatCount="indefinite"/>')
        s.append(f'<g filter="url(#glow)">{window(0.01, cycle - 0.6, cycle)}'
                 f'<rect x="-5" y="-5" width="10" height="10" fill="{SIGNAL}">{motion}</rect></g>')
        # a chat line narrating each stop
        s.append(f'<rect x="16" y="{cap_y - 16}" width="{self.w - 32}" height="24" fill="#000" opacity=".55"/>')
        s.append(f'<text x="24" y="{cap_y}" {PF} font-size="12" fill="{INK2}">&lt;{who}&gt;</text>')
        for i, cap in enumerate(captions):
            on = stops[i][0]
            off = stops[i + 1][0] if i + 1 < len(stops) else cycle - 0.6
            # an invisible copy of the prefix keeps the caption aligned in any font
            s.append(f'<g opacity="0">{window(on, off, cycle)}<text x="24" y="{cap_y}" {PF} font-size="12" '
                     f'fill="{INK}" xml:space="preserve"><tspan fill-opacity="0">&lt;{who}&gt; </tspan>{esc(cap)}</text></g>')
        s.append('</svg>')
        return "\n".join(s) + "\n"


def write(name, svg):
    Path(__file__).with_name(name).write_text(svg, encoding="utf-8")


def architecture():
    X = [24, 234, 444, 654]
    f = Flow(W, 376, "How Daedalus answers a question: the dashboard sends it to FastAPI, intent is classified, "
                     "a safety guard refuses control requests, deterministic tools read the read-only sensor "
                     "database (or Track 1 / Track 2 search the knowledge base), an evidence pack goes to the "
                     "local Ollama model, a validator checks every number, and a cited answer streams back",
             "daedalus · how one question is answered")
    f.box("you", X[0], 52, "01 you", "type in the dashboard")
    f.box("api", X[1], 52, "02 fastapi", "POST /api/chat")
    f.box("intent", X[2], 52, "03 intent", "live · trend · procedure")
    f.box("guard", X[3], 52, "04 safety guard", "control? → refuse")
    f.box("refused", X[3], 132, "refused", "no tool · no model call", tone="bad")
    f.box("tools", X[0], 132, "05 sensor tools", "deterministic · 33")
    f.box("sqlite", X[1], 132, "06 sqlite", "sensor db · mode=ro")
    f.box("t1", X[0], 186, "track 1 · vector", "embed → top-k → rerank")
    f.box("chroma", X[1], 186, "chromadb", "887 chunks")
    f.box("t2", X[0], 240, "track 2 · graph", "alias entry → hops")
    f.box("graph", X[1], 240, "knowledge graph", "62 nodes")
    f.box("evidence", X[2], 186, "07 evidence", "labelled [S1] [S2]")
    f.box("ollama", X[3], 186, "08 ollama", "qwen3:1.7b · local")
    f.box("validator", X[3], 264, "09 validator", "numbers in evidence?")
    f.box("answer", X[2], 264, "10 answer", "cited, streamed back")
    for a, b in [("you", "api"), ("api", "intent"), ("intent", "guard"), ("tools", "sqlite"),
                 ("t1", "chroma"), ("t2", "graph"), ("sqlite", "evidence"), ("chroma", "evidence"),
                 ("graph", "evidence"), ("evidence", "ollama"), ("ollama", "validator"), ("validator", "answer")]:
        f.edge(a, b)
    f.edge("guard", "refused", tone="bad")
    gx = X[3] + f.bw / 2
    for k in ("tools", "t1", "t2"):        # a trunk down the left margin feeds all three routes
        f.edge("guard", k, [(gx, 92), (gx, 114), (12, 114), (12, f.c(k)[1]), (X[0], f.c(k)[1])])
    write("architecture.svg", f.render(
        ["you", "api", "intent", "guard", "tools", "sqlite", "evidence", "ollama", "validator", "answer"],
        ['what is the current co2 concentration and reactor temperature?',
         "POST /api/chat · query_id q_20261011_111807373513",
         "intent = live_status → sensor tools, not the knowledge base",
         'not a control request → go on  ("open valve ABV-1" stops here)',
         "get_live_reading ×2 · 1 ms",
         "co2_ppm 488.5 · temp_c 31.74 · read-only connection",
         "[S1] co2_ppm 488.5 ppm   [S2] temp_c 31.74 °C",
         "qwen3:1.7b phrases only the evidence · 38.3 s",
         "488.5 ✓  31.74 ✓  → grounded",
         "co2 is 488.5 ppm [S1], temperature 31.74 °C [S2]"],
        cap_y=346, who="you"))


def strip(name, heading, title, stages, captions, who):
    n, bw, gap = len(stages), 124, 14
    x0 = (W - (n * bw + (n - 1) * gap)) // 2
    f = Flow(W, 160, title, heading, bw=bw)
    for i, (nm, sub) in enumerate(stages):
        f.box(i, x0 + i * (bw + gap), 52, nm, sub)
    for i in range(n - 1):
        f.edge(i, i + 1)
    write(name, f.render(list(range(n)), captions, cap_y=132, who=who))


def forge():
    strip("forge.svg", "the forge · hardware & model console",
          "The Forge: detect this machine's hardware, estimate each model's memory, score its fit, "
          "pull it through Ollama, benchmark it on a RAG-sized prompt, and commit the choice",
          [("detect", "cpu · ram · vram"), ("estimate", "model × quant"), ("fit", "2 memory pools"),
           ("pull", "via ollama"), ("benchmark", "~2k-token prompt"), ("commit", "model_config")],
          ["i5-11400H · 7.8 GB RAM · RTX 3050, 4 GB VRAM",
           "qwen3:1.7b · Q4_K_M · 1.3 GB on disk",
           "verdict: safe   (safe / marginal / will_not_fit)",
           "ollama pull qwen3:1.7b",
           "TTFT median 1.1 s over 5 runs",
           "committed — chat now answers with qwen3:1.7b"],
          "forge")


def ingest():
    strip("ingest.svg", "labyrinth blueprints · build the corpus",
          "Labyrinth Blueprints, Track 1 build: upload a document, extract its text, chunk it, embed the "
          "chunks with a local model, and store them in ChromaDB with each document's category and origin",
          [("upload", "pdf · category"), ("extract", "pypdf, locked too"), ("chunk", "1,500 chars"),
           ("embed", "local model"), ("store", "chromadb"), ("record", "corpus.db")],
          ["Fuji_ZRE3_NDIR_Analyzer_Manual.pdf · manual · reference",
           "text out, including AES-locked and font-shifted PDFs",
           "recursive split · 1,500 chars · 200 overlap",
           "qwen3-embedding:0.6b → 1,024-d vectors",
           "vectors into chromadb, embedded in the API process",
           "17 documents · 887 chunks · every run replayable"],
          "blueprints")


def retrieval():
    """Both tracks searching for the same question, side by side."""
    H, cycle = 432, 13.0
    s = card(W, H, "Searching the knowledge base. Track 1 embeds the question, pulls 20 candidate chunks from "
                   "ChromaDB and re-ranks them to keep the best 5. Track 2 enters the graph by alias at "
                   "'NDIR reading drift', hops RESOLVED_BY to the NDIR calibration SOP and CONTAINS to its "
                   "three steps, under a 6 second, 4 step budget. Nodes and edges are real; the walk is illustrative",
             "daedalus · searching the knowledge base")
    s.append(f'<rect x="16" y="42" width="{W - 32}" height="24" fill="#000" opacity=".55"/>')
    s.append(f'<text x="24" y="58" {PF} font-size="12" fill="{INK2}">&lt;you&gt; '
             f'<tspan fill="{INK}">what do i do if the ndir reading drifts?</tspan></text>')
    mid = W // 2
    s.append(f'<rect x="{mid - 1}" y="80" width="2" height="{H - 100}" fill="{STONE_LO}"/>')
    # ── track 1 ──
    lx = 24
    s.append(f'<text x="{lx}" y="98" {PF} font-size="12" fill="{INK}">track 1 · vector rag</text>')
    steps1 = [(0.6, "embed  qwen3-embedding:0.6b → 1,024-d"),
              (2.4, "search chromadb · 887 → 20 candidates"),
              (5.6, "rerank ms-marco-minilm-l6 → top 5"),
              (8.6, "→ evidence pack, each chunk cited")]
    for i, (t, txt) in enumerate(steps1):
        s.append(f'<g opacity="0">{window(t, cycle - 0.5, cycle)}<text x="{lx}" y="{122 + i * 18}" {PF} '
                 f'font-size="10" fill="{INK2}">{esc(txt)}</text></g>')
    rng = random.Random(3)
    for j in range(32):                               # the query vector, as emerald cells
        shade = rng.choice(["#0f5c2e", "#17a34a", "#22c55e", "#15803d", "#86efac"])
        s.append(f'<rect x="{lx + j * 11}" y="200" width="9" height="9" fill="{shade}" opacity="0">'
                 f'{window(0.8 + j * 0.03, cycle - 0.5, cycle)}</rect>')
    first = sorted((rng.uniform(.45, .9) for _ in range(20)), reverse=True)
    rerank = [rng.uniform(.05, .5) for _ in range(20)]
    for j in rng.sample(range(20), 5):
        rerank[j] = rng.uniform(.75, .98)
    top = set(sorted(range(20), key=lambda j: -rerank[j])[:5])
    for j in range(20):                               # 20 candidates, then re-ranked
        y = 226 + j * 8
        w1, w2 = round(first[j] * 75) * 4, round(rerank[j] * 75) * 4
        col = LAMP_ON if j in top else "#3a3a42"
        s.append(f'<rect x="{lx}" y="{y}" height="6" width="{w1}" fill="#6b6b78" opacity="0">'
                 f'{window(2.6 + j * 0.05, cycle - 0.5, cycle)}'
                 f'<animate attributeName="width" values="{w1};{w1};{w2};{w2}" '
                 f'keyTimes="0;{5.8 / cycle:.4f};{6.8 / cycle:.4f};1" dur="{cycle}s" repeatCount="indefinite"/>'
                 f'<animate attributeName="fill" values="#6b6b78;{col}" calcMode="discrete" '
                 f'keyTimes="0;{6.9 / cycle:.4f}" dur="{cycle}s" repeatCount="indefinite"/></rect>')
    s.append(f'<text x="{lx}" y="{H - 16}" {PF} font-size="9" fill="{INK2}">bar = relevance score, illustrative</text>')
    # ── track 2 ──
    rx = mid + 24
    s.append(f'<text x="{rx}" y="98" {PF} font-size="12" fill="{INK}">track 2 · agentic graphrag</text>')
    steps2 = [(0.6, 'entry  alias "ndir reading drifts"'),
              (3.0, "hop 1  RESOLVED_BY → NDIR calibration SOP"),
              (5.6, "hop 2  CONTAINS → its 3 steps"),
              (8.6, "model: enough → stop (budget 4 steps, 6 s)")]
    for i, (t, txt) in enumerate(steps2):
        s.append(f'<g opacity="0">{window(t, cycle - 0.5, cycle)}<text x="{rx}" y="{122 + i * 18}" {PF} '
                 f'font-size="10" fill="{INK2}">{esc(txt)}</text></g>')
    gn = {  # node: (x, y, label, lit_at)
        "co2": (rx + 10, 206, "sensor co2_ppm", None),
        "drift": (rx + 10, 296, "ndir reading drift", 1.0),
        "brk": (rx + 10, 386, "co2 breakthrough", None),
        "cal": (rx + 130, 244, "sop ndir calibration", 3.4),
        "fuji": (rx + 130, 350, "sop fuji ndir maint.", None),
        "s1": (rx + 262, 216, "isolate analyser", 6.0),
        "s2": (rx + 262, 262, "zero with N₂", 6.3),
        "s3": (rx + 262, 308, "span with gas", 6.6),
    }
    links = [("drift", "cal", 3.0), ("drift", "fuji", None), ("cal", "s1", 5.6), ("cal", "s2", 5.6),
             ("cal", "s3", 5.6), ("brk", "cal", None)]
    for a, b, t in links:                              # dust between nodes, elbowed like a circuit
        (ax, ay, *_), (bx, by, *_) = gn[a], gn[b]
        mx = (ax + bx) // 2
        pts = f"{ax},{ay} {mx},{ay} {mx},{by} {bx},{by}"
        s.append(f'<polyline points="{pts}" fill="none" stroke="{DUST_OFF}" stroke-width="3"/>')
        if t is not None:
            ln = abs(bx - ax) + abs(by - ay)
            s.append(f'<polyline points="{pts}" fill="none" stroke="{DUST_ON}" stroke-width="3" filter="url(#glow)" '
                     f'stroke-dasharray="{ln}" stroke-dashoffset="{ln}">'
                     f'<animate attributeName="stroke-dashoffset" values="{ln};{ln};0;0" '
                     f'keyTimes="0;{t / cycle:.4f};{(t + 0.5) / cycle:.4f};1" dur="{cycle}s" repeatCount="indefinite"/>'
                     f'{window(0.01, cycle - 0.5, cycle)}</polyline>')
    for k, (x, y, label, t) in gn.items():
        s.append(block(x - 8, y - 8, 16, 16))
        if t is not None:
            s.append(f'<g opacity="0" filter="url(#glow)">{window(t, cycle - 0.5, cycle)}'
                     f'<rect x="{x - 6}" y="{y - 6}" width="12" height="12" fill="{LAMP_ON}"/>'
                     f'<rect x="{x - 3}" y="{y - 3}" width="6" height="6" fill="{LAMP_CORE}"/></g>')
        ly = y + 20 if k in ("cal", "fuji") else y + 4
        lx2 = x - 40 if k in ("cal", "fuji") else x + 14
        s.append(f'<text x="{lx2}" y="{ly}" {PF} font-size="9" fill="{INK if t else INK2}">{esc(label)}</text>')
    s.append(f'<text x="{rx}" y="{H - 16}" {PF} font-size="9" fill="{INK2}">real nodes and edges from knowledge_graph.yaml · walk illustrative</text>')
    s.append('</svg>')
    write("retrieval.svg", "\n".join(s) + "\n")


# ── latency charts ───────────────────────────────────────────────────────────
DB = ROOT / "logs" / "ai_logs.db"
MODEL, CLOUD = "qwen3:1.7b", "gpt-oss:120b-cloud"
SERIES = [("load", "#3987e5"), ("prefill", "#d95926"), ("generation", "#199e70")]  # validated on DEEP[0]
GRID = "#2c2c33"


def runs():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    q = ("select time_to_first_token_ms, load_ms, prefill_ms, generation_ms, completion_token_count "
         "from model_logs where model_name=? and source=? and status='ok' and time_to_first_token_ms is not null")
    out = {src: [r for r in con.execute(q, (MODEL, src)) if r[1] is not None] for src in ("benchmark", "chat")}
    out["cloud"] = con.execute(q, (CLOUD, "benchmark_cloud")).fetchall()
    return out


def axis(s, x0, x1, top, base, vmax, step, unit):
    for v in range(0, vmax + 1, step):
        x = x0 + v / vmax * (x1 - x0)
        s.append(f'<rect x="{x:.0f}" y="{top}" width="1" height="{base - top}" fill="{GRID}"/>')
        s.append(f'<text x="{x:.0f}" y="{base + 18}" {PF} font-size="10" fill="{INK2}" text-anchor="middle">{v}{unit}</text>')


def ttft_chart(data):
    h, x0, x1, vmax = 290, 270, W - 40, 35
    sx = lambda ms: x0 + (ms / 1000) / vmax * (x1 - x0)
    s = card(W, h, f"Time to first token: {MODEL} benchmark runs and live chat turns, and the {CLOUD} "
                   "cloud baseline, against the 3 second target", "daedalus · latency")
    s.append(f'<text x="24" y="58" {PF} font-size="13" fill="{INK}">time to first token · RTX 3050 Laptop, 4 GB</text>')
    base = 234
    axis(s, x0, x1, 80, base, vmax, 5, " s")
    tx = sx(3000)
    s.append(f'<line x1="{tx:.0f}" y1="76" x2="{tx:.0f}" y2="{base}" stroke="{INK}" stroke-dasharray="4 4"/>')
    s.append(f'<text x="{tx + 6:.0f}" y="88" {PF} font-size="10" fill="{INK}">target &lt; 3 s</text>')
    rows = [("benchmark", f"{MODEL} · benchmark", False),
            ("chat", f"{MODEL} · live chat", False),
            ("cloud", "cloud baseline · 120b", True)]
    for i, (key, label, hollow) in enumerate(rows):
        y = 112 + i * 46
        vals = sorted(r[0] for r in data[key])
        med = statistics.median(vals)
        s.append(f'<text x="24" y="{y + 4}" {PF} font-size="11" fill="{INK}">{label}</text>')
        s.append(f'<text x="24" y="{y + 19}" {PF} font-size="10" fill="{INK2}">n={len(vals)} · median {med / 1000:.1f} s</text>')
        for v in vals:
            x = sx(v)
            if hollow:   # a different marker, so the baseline is never told apart by colour alone
                s.append(f'<rect x="{x - 4:.0f}" y="{y - 4}" width="8" height="8" fill="none" stroke="{LAMP_ON}" stroke-width="2"/>')
            else:
                s.append(f'<rect x="{x - 5:.0f}" y="{y - 5}" width="10" height="10" fill="{OUTLINE}"/>'
                         f'<rect x="{x - 4:.0f}" y="{y - 4}" width="8" height="8" fill="{LAMP_ON}"/>')
        s.append(f'<rect x="{sx(med) - 1:.0f}" y="{y - 12}" width="2" height="24" fill="{INK}"/>')
    s.append(f'<text x="24" y="{h - 14}" {PF} font-size="9" fill="{INK2}">each block is one run · white bar = median · '
             'hollow = cloud baseline, not production · source: audit db</text>')
    s.append('</svg>')
    write("ttft.svg", "\n".join(s) + "\n")


def phases_chart(data):
    h, x0, x1, vmax = 236, 270, W - 40, 25
    means = {k: [statistics.mean(r[j] for r in data[k]) for j in (1, 2, 3)] for k in ("benchmark", "chat")}
    scale = (x1 - x0) / (vmax * 1000)
    s = card(W, h, "Mean time per phase for one answer, benchmark vs live chat: generation dominates, prefill stays small",
             "daedalus · latency")
    s.append(f'<text x="24" y="58" {PF} font-size="13" fill="{INK}">where an answer\'s time goes · mean per phase</text>')
    lx = 24
    for name, col in SERIES:   # legend, one row above the plot
        s.append(f'<rect x="{lx}" y="74" width="10" height="10" fill="{col}"/>')
        s.append(f'<text x="{lx + 16}" y="83" {PF} font-size="10" fill="{INK}">{name}</text>')
        lx += 16 + len(name) * 6 + 22
    base = 184
    axis(s, x0, x1, 100, base, vmax, 5, " s")
    for i, (key, label) in enumerate([("benchmark", "benchmark · 128 out"), ("chat", "live chat")]):
        y = 112 + i * 36
        s.append(f'<text x="24" y="{y + 15}" {PF} font-size="11" fill="{INK}">{label}</text>')
        x = x0
        for j, ((name, col), ms) in enumerate(zip(SERIES, means[key])):
            wd = ms * scale
            s.append(f'<rect x="{x:.0f}" y="{y}" width="{max(wd - 2, 1):.0f}" height="22" fill="{col}"/>')
            x += wd
        s.append(f'<text x="{x + 8:.0f}" y="{y + 15}" {PF} font-size="10" fill="{INK}">{sum(means[key]) / 1000:.1f} s</text>')
    s.append(f'<text x="24" y="{h - 14}" {PF} font-size="9" fill="{INK2}">generation includes every output token; '
             'chat answers run longer than the benchmark\'s 128</text>')
    s.append('</svg>')
    write("phases.svg", "\n".join(s) + "\n")
    return means


if __name__ == "__main__":
    build()
    architecture()
    retrieval()
    forge()
    ingest()
    if DB.exists():
        data = runs()
        ttft_chart(data)
        means = phases_chart(data)
        for k, rows in data.items():   # numbers for the README's table view
            v = sorted(r[0] for r in rows)
            gen = sorted(r[4] / (r[3] / 1000) for r in rows if r[3] and r[4])
            extra = f" phase means(load,prefill,gen)={[round(m) for m in means[k]]}" if k in means else ""
            print(f"{k}: n={len(v)} ttft median={statistics.median(v):.0f} min={v[0]} max={v[-1]}"
                  + (f" gen tok/s median={statistics.median(gen):.1f}" if gen else "") + extra)
    else:
        print(f"skipped charts: {DB} not found")
