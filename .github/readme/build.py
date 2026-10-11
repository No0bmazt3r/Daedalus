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
from collections import deque
from pathlib import Path

GLYPHS = {
    "D": ["██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "],
    "A": [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
    "E": ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
    "L": ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
    "U": ["██╗   ██╗", "██║   ██║", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
    "S": ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
}
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
    """Fixed-seed DFS maze on a (2n+1)² grid, open at the bottom-left, and the
    BFS route from that opening to the centre room."""
    g = 2 * MAZE_N + 1
    wall = [[True] * g for _ in range(g)]
    rng, stack = random.Random(7), [(0, 0)]
    wall[1][1] = False
    while stack:
        x, y = stack[-1]
        nxt = [(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
               if 0 <= x + dx < MAZE_N and 0 <= y + dy < MAZE_N and wall[2 * (y + dy) + 1][2 * (x + dx) + 1]]
        if not nxt:
            stack.pop()
            continue
        nx, ny = rng.choice(nxt)
        wall[y + ny + 1][x + nx + 1] = wall[2 * ny + 1][2 * nx + 1] = False
        stack.append((nx, ny))
    start, goal = (1, g - 1), (MAZE_N, MAZE_N)     # (col, row)
    wall[g - 1][1] = False
    prev, q = {start: None}, deque([start])
    while q:
        c = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (c[0] + dx, c[1] + dy)
            if 0 <= n[0] < g and 0 <= n[1] < g and not wall[n[1]][n[0]] and n not in prev:
                prev[n] = c
                q.append(n)
    route, c = [], goal
    while c:
        route.append(c)
        c = prev[c]
    return wall, route[::-1]


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


# ── animated flows ───────────────────────────────────────────────────────────
# One engine: boxes, edges, and a packet that travels a route through them,
# lighting each box as it arrives while a caption line narrates the real values.
TEXT, MUTED, EDGE, LIT = "#c9d1d9", "#8b949e", "#30363d", "#12261a"
SPEED, HOLD = 360, 1.15            # px/s along an edge; seconds parked on a box


def card(w, h, title, heading):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-label="{esc(title)}">',
            '<defs><filter id="pglow" x="-200%" y="-200%" width="500%" height="500%">'
            '<feGaussianBlur stdDeviation="3"/></filter></defs>',
            f'<rect width="{w}" height="{h}" rx="10" fill="{BG}"/>',
            f'<path d="M0 10a10 10 0 0 1 10-10h{w - 20}a10 10 0 0 1 10 10v20H0z" fill="{BAR}"/>',
            *[f'<circle cx="{20 + i * 18}" cy="15" r="5.5" fill="{c}"/>'
              for i, c in enumerate(["#ff5f57", "#febc2e", "#28c840"])],
            f'<text x="{w // 2}" y="19" fill="{MUTED}" {FONT} font-size="12" text-anchor="middle">{esc(heading)}</text>']


def window(on, off, cycle):
    """Discrete opacity: hidden, shown from `on` to `off`, hidden again; loops."""
    return (f'<animate attributeName="opacity" values="0;1;0" calcMode="discrete" '
            f'keyTimes="0;{on / cycle:.4f};{off / cycle:.4f}" dur="{cycle:.2f}s" repeatCount="indefinite"/>')


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class Flow:
    def __init__(self, w, h, title, heading, bw=182, bh=40):
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
            if ay == by:                                   # same row
                pts = [(ax + self.bw, acy), (bx, bcy)] if bx > ax else [(ax, acy), (bx + self.bw, bcy)]
            elif ax == bx:                                 # same column
                pts = [(acx, ay + self.bh), (bcx, by)] if by > ay else [(acx, ay), (bcx, by + self.bh)]
            else:                                          # elbow through the gap between columns
                mx = (ax + self.bw + bx) / 2
                pts = [(ax + self.bw, acy), (mx, acy), (mx, bcy), (bx, bcy)]
        self.edges[(a, b)] = (pts, tone)

    def render(self, route, captions, cap_y, prompt="you@daedalus:~$"):
        s = self.s
        for (pts, tone) in self.edges.values():
            col, dash = (THREAD, ' stroke-dasharray="4 4"') if tone == "bad" else (EDGE, "")
            s.append(f'<polyline points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" fill="none" '
                     f'stroke="{col}" stroke-width="1.5"{dash}/>')
        # schedule: arrive/depart times per stop, and the packet's path through them
        path, at, t, length, stops = [], [], 0.6, 0.0, []
        for i, k in enumerate(route):
            if i == 0:
                path.append(self.c(k))
            else:
                pts = self.edges[(route[i - 1], k)][0]
                seg = [path[-1], *pts, self.c(k)]
                for p, q in zip(seg, seg[1:]):
                    length += abs(q[0] - p[0]) + abs(q[1] - p[1])
                path += seg[1:]
                t += max(0.35, (sum(abs(q[0] - p[0]) + abs(q[1] - p[1]) for p, q in zip(seg, seg[1:]))) / SPEED)
            stops.append((t, length))
            t += HOLD
        cycle = t + 1.6
        # trail of where the packet has been
        d = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in path)
        kt, kv = ["0"], [f"{length:.1f}"]
        for (a, l) in stops:
            kt += [f"{a / cycle:.4f}", f"{min(a + HOLD, cycle - 1) / cycle:.4f}"]
            kv += [f"{length - l:.1f}"] * 2
        kt.append("1"); kv.append("0")
        s.append(f'<path d="{d}" fill="none" stroke="{GREEN}" stroke-width="2" stroke-dasharray="{length:.1f}" '
                 f'stroke-dashoffset="{length:.1f}" opacity=".55"><animate attributeName="stroke-dashoffset" '
                 f'values="{";".join(kv)}" keyTimes="{";".join(kt)}" dur="{cycle:.2f}s" repeatCount="indefinite"/>'
                 f'{window(0.01, cycle - 0.6, cycle)}</path>')
        # boxes, lit on arrival
        arrive = {k: stops[i][0] for i, k in enumerate(route)}
        for k, (x, y, name, sub, tone) in self.nodes.items():
            stroke = THREAD if tone == "bad" else EDGE
            s.append(f'<rect x="{x}" y="{y}" width="{self.bw}" height="{self.bh}" rx="6" fill="{BAR}" stroke="{stroke}"/>')
            if k in arrive:
                s.append(f'<rect x="{x}" y="{y}" width="{self.bw}" height="{self.bh}" rx="6" fill="{LIT}" '
                         f'stroke="{GREEN}" opacity="0">{window(arrive[k], cycle - 0.6, cycle)}</rect>')
            s.append(f'<text x="{x + 10}" y="{y + 17}" {FONT} font-size="12" '
                     f'fill="{THREAD if tone == "bad" else TEXT}">{esc(name)}</text>')
            s.append(f'<text x="{x + 10}" y="{y + 32}" {FONT} font-size="10" fill="{MUTED}">{esc(sub)}</text>')
        # the packet
        kp = ["0"]
        for (a, l) in stops:
            kp += [f"{l / length:.4f}"] * 2
        kp.append("1")
        motion = (f'<animateMotion path="{d}" keyPoints="{";".join(kp)}" keyTimes="{";".join(kt)}" '
                  f'calcMode="linear" dur="{cycle:.2f}s" repeatCount="indefinite"/>')
        s.append(f'<g>{window(0.01, cycle - 0.6, cycle)}'
                 f'<circle r="7" fill="{GREEN}" opacity=".6" filter="url(#pglow)">{motion}</circle>'
                 f'<circle r="4" fill="#d2ffd8">{motion}</circle></g>')
        # caption line narrating each stop
        s.append(f'<text x="24" y="{cap_y}" {FONT} font-size="12" fill="{MUTED}">{prompt}</text>')
        for i, cap in enumerate(captions):
            on = stops[i][0]
            off = stops[i + 1][0] if i + 1 < len(stops) else cycle - 0.6
            s.append(f'<g opacity="0">{window(on, off, cycle)}<text x="{24 + (len(prompt) + 1) * 7.2:.1f}" '
                     f'y="{cap_y}" {FONT} font-size="12" fill="{GREEN}">{esc(cap)}</text></g>')
        s.append('</svg>')
        return "\n".join(s) + "\n"


def write(name, svg):
    Path(__file__).with_name(name).write_text(svg, encoding="utf-8")


def architecture():
    X = [24, 234, 444, 654]
    f = Flow(W, 372, "How Daedalus answers a question: the dashboard sends it to FastAPI, intent is classified, "
                     "a safety guard refuses control requests, deterministic tools read the read-only sensor "
                     "database (or Track 1 / Track 2 search the knowledge base), an evidence pack goes to the "
                     "local Ollama model, a validator checks every number, and a cited answer streams back",
             "daedalus — how one question is answered")
    f.box("you", X[0], 52, "01 you", "type in the dashboard")
    f.box("api", X[1], 52, "02 fastapi", "POST /api/chat")
    f.box("intent", X[2], 52, "03 intent", "live · trend · procedure")
    f.box("guard", X[3], 52, "04 safety guard", "control? → refuse")
    f.box("refused", X[3], 132, "refused", "no tool · no model call", tone="bad")
    f.box("tools", X[0], 132, "05 sensor tools", "deterministic, 33 total")
    f.box("sqlite", X[1], 132, "06 sqlite", "sensor db · mode=ro")
    f.box("t1", X[0], 186, "track 1 · vector", "embed → top-k → re-rank")
    f.box("chroma", X[1], 186, "chromadb", "887 chunks")
    f.box("t2", X[0], 240, "track 2 · graph", "alias entry → hops")
    f.box("graph", X[1], 240, "knowledge graph", "62 nodes")
    f.box("evidence", X[2], 186, "07 evidence pack", "labelled [S1] [S2] …")
    f.box("ollama", X[3], 186, "08 ollama", "qwen3:1.7b · local")
    f.box("validator", X[3], 260, "09 validator", "every number in evidence?")
    f.box("answer", X[2], 260, "10 answer", "cited, streamed back")
    for a, b in [("you", "api"), ("api", "intent"), ("intent", "guard"), ("tools", "sqlite"),
                 ("t1", "chroma"), ("t2", "graph"), ("sqlite", "evidence"), ("chroma", "evidence"),
                 ("graph", "evidence"), ("evidence", "ollama"), ("ollama", "validator"), ("validator", "answer")]:
        f.edge(a, b)
    f.edge("guard", "refused", tone="bad")
    gx = X[3] + f.bw / 2
    for k in ("tools", "t1", "t2"):        # a trunk down the left margin feeds all three routes
        f.edge("guard", k, [(gx, 92), (gx, 114), (12, 114), (12, f.c(k)[1]), (X[0], f.c(k)[1])])
    svg = f.render(
        ["you", "api", "intent", "guard", "tools", "sqlite", "evidence", "ollama", "validator", "answer"],
        ['"what is the current co2 concentration and reactor temperature?"',
         "POST /api/chat · query_id q_20261011_111807373513",
         "intent = live_status → sensor tools, not the knowledge base",
         'not a control request → continue  ("open valve ABV-1" stops here)',
         "get_live_reading ×2 · 1 ms",
         "co2_ppm 488.5 · temp_c 31.74 · read-only connection",
         "[S1] co2_ppm 488.5 ppm   [S2] temp_c 31.74 °C",
         "qwen3:1.7b phrases only the evidence · 38.3 s on an RTX 3050",
         "488.5 ✓  31.74 ✓  → grounded",
         "co2 is 488.5 ppm [S1], temperature 31.74 °C [S2]"],
        cap_y=338)
    write("architecture.svg", svg)


def strip(name, heading, title, stages, captions, prompt):
    n = len(stages)
    bw, gap = 122, 16
    x0 = (W - (n * bw + (n - 1) * gap)) // 2
    f = Flow(W, 150, title, heading, bw=bw)
    for i, (nm, sub) in enumerate(stages):
        f.box(i, x0 + i * (bw + gap), 52, nm, sub)
    for i in range(n - 1):
        f.edge(i, i + 1)
    write(name, f.render(list(range(n)), captions, cap_y=124, prompt=prompt))


def forge():
    strip("forge.svg", "the forge — hardware & model console",
          "The Forge: detect this machine's hardware, estimate each model's memory, score its fit, "
          "pull it through Ollama, benchmark it on a RAG-sized prompt, and commit the choice",
          [("detect", "cpu · ram · vram"), ("estimate", "model × quant"), ("fit verdict", "both memory pools"),
           ("pull", "via ollama"), ("benchmark", "~2k-token prompt"), ("commit", "model_config.json")],
          ["i5-11400H · 7.8 GB RAM · RTX 3050, 4 GB VRAM",
           "qwen3:1.7b · Q4_K_M · 1.3 GB on disk",
           "verdict: safe   (safe / marginal / will_not_fit)",
           "ollama pull qwen3:1.7b",
           "TTFT median 1.1 s over 5 runs",
           "committed — chat now answers with qwen3:1.7b"],
          "forge:~$")


def ingest():
    strip("ingest.svg", "labyrinth blueprints — build the corpus",
          "Labyrinth Blueprints, Track 1 build: upload a document, extract its text, chunk it, embed the "
          "chunks with a local model, and store them in ChromaDB with each document's category and origin",
          [("upload", "pdf · category"), ("extract", "pypdf, locked too"), ("chunk", "1,500 chars"),
           ("embed", "local model"), ("store", "chromadb"), ("record", "corpus.db")],
          ["Fuji_ZRE3_NDIR_Analyzer_Manual.pdf · manual · reference · 85 pages",
           "text out, including AES-locked and font-shifted PDFs",
           "recursive split · 1,500 chars · 200 overlap · context header",
           "qwen3-embedding:0.6b → 1,024-d vectors",
           "vectors into chromadb, embedded in the API process",
           "17 documents · 887 chunks · every run replayable"],
          "blueprints:~$")


def retrieval():
    """Both tracks searching for the same question, side by side."""
    H, cycle = 420, 13.0
    s = card(W, H, "Searching the knowledge base. Track 1 embeds the question, pulls 20 candidate chunks from "
                   "ChromaDB and re-ranks them to keep the best 5. Track 2 enters the graph by alias at "
                   "'NDIR reading drift', hops RESOLVED_BY to the NDIR calibration SOP and CONTAINS to its "
                   "three steps, under a 6 second, 4 step budget",
             "daedalus — searching the knowledge base")
    s.append(f'<text x="24" y="58" {FONT} font-size="13" fill="{MUTED}">q: '
             f'<tspan fill="{TEXT}">"what do i do if the ndir reading drifts?"</tspan></text>')
    mid = W // 2
    s.append(f'<line x1="{mid}" y1="76" x2="{mid}" y2="{H - 20}" stroke="{EDGE}"/>')
    # ── track 1 ──
    lx = 24
    s.append(f'<text x="{lx}" y="96" {FONT} font-size="13" fill="{TEXT}">track 1 · vector rag</text>')
    steps1 = [(0.6, "embed   qwen3-embedding:0.6b → 1,024-d"),
              (2.4, "search  chromadb · 887 chunks → 20 candidates"),
              (5.6, "re-rank ms-marco-minilm-l6 → keep top 5"),
              (8.6, "→ evidence pack, each chunk cited")]
    for i, (t, txt) in enumerate(steps1):
        s.append(f'<g opacity="0">{window(t, cycle - 0.5, cycle)}<text x="{lx}" y="{120 + i * 18}" {FONT} '
                 f'font-size="11" fill="{MUTED}">{esc(txt)}</text></g>')
    # the query vector: a strip of cells
    rng = random.Random(3)
    for j in range(32):
        shade = rng.choice(["#1f6f2b", "#2ea043", "#3fb950", "#238636", "#196c2e"])
        s.append(f'<rect x="{lx + j * 11}" y="200" width="9" height="9" rx="1" fill="{shade}" opacity="0">'
                 f'{window(0.8 + j * 0.03, cycle - 0.5, cycle)}</rect>')
    # 20 candidates: first-pass scores, then re-ranked scores
    first = sorted((rng.uniform(.45, .9) for _ in range(20)), reverse=True)
    rerank = [rng.uniform(.05, .5) for _ in range(20)]
    for j in rng.sample(range(20), 5):
        rerank[j] = rng.uniform(.75, .98)
    top = set(sorted(range(20), key=lambda j: -rerank[j])[:5])
    for j in range(20):
        y = 224 + j * 8
        w1, w2 = first[j] * 300, rerank[j] * 300
        col = GREEN if j in top else "#30363d"
        s.append(f'<rect x="{lx}" y="{y}" height="5" rx="2" width="{w1:.1f}" fill="#484f58" opacity="0">'
                 f'{window(2.6 + j * 0.05, cycle - 0.5, cycle)}'
                 f'<animate attributeName="width" values="{w1:.1f};{w1:.1f};{w2:.1f};{w2:.1f}" '
                 f'keyTimes="0;{5.8 / cycle:.4f};{6.8 / cycle:.4f};1" dur="{cycle}s" repeatCount="indefinite"/>'
                 f'<animate attributeName="fill" values="#484f58;{col}" calcMode="discrete" '
                 f'keyTimes="0;{6.9 / cycle:.4f}" dur="{cycle}s" repeatCount="indefinite"/></rect>')
    s.append(f'<text x="{lx}" y="{H - 18}" {FONT} font-size="10" fill="{MUTED}">bar = relevance score, illustrative</text>')
    # ── track 2 ──
    rx = mid + 24
    s.append(f'<text x="{rx}" y="96" {FONT} font-size="13" fill="{TEXT}">track 2 · agentic graphrag</text>')
    steps2 = [(0.6, 'entry   alias "ndir reading drifts" → AnomalyType'),
              (3.0, "hop 1   RESOLVED_BY → SOP: NDIR calibration"),
              (5.6, "hop 2   CONTAINS → 3 steps"),
              (8.6, "model: enough → stop  (budget 4 steps, 6 s)")]
    for i, (t, txt) in enumerate(steps2):
        s.append(f'<g opacity="0">{window(t, cycle - 0.5, cycle)}<text x="{rx}" y="{120 + i * 18}" {FONT} '
                 f'font-size="11" fill="{MUTED}">{esc(txt)}</text></g>')
    gn = {  # node: (x, y, label, lit_at or None)
        "drift": (rx + 10, 290, "NDIR reading drift", 1.0),
        "cal": (rx + 120, 236, "SOP · NDIR calibration", 3.4),
        "fuji": (rx + 120, 340, "SOP · Fuji NDIR maint.", None),
        "s1": (rx + 255, 214, "isolate analyser", 6.0),
        "s2": (rx + 255, 258, "zero with N₂", 6.3),
        "s3": (rx + 255, 302, "span with gas", 6.6),
        "co2": (rx + 10, 200, "Sensor: co2_ppm", None),
        "brk": (rx + 10, 372, "co2 breakthrough", None),
    }
    links = [("drift", "cal", 3.0), ("drift", "fuji", None), ("cal", "s1", 5.6), ("cal", "s2", 5.6),
             ("cal", "s3", 5.6), ("brk", "cal", None)]
    for a, b, t in links:
        (ax, ay, *_), (bx, by, *_) = gn[a], gn[b]
        s.append(f'<line x1="{ax + 4}" y1="{ay}" x2="{bx - 4}" y2="{by}" stroke="{EDGE}" stroke-width="1.5"/>')
        if t is not None:
            ln = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
            s.append(f'<line x1="{ax + 4}" y1="{ay}" x2="{bx - 4}" y2="{by}" stroke="{GREEN}" stroke-width="2" '
                     f'stroke-dasharray="{ln:.1f}" stroke-dashoffset="{ln:.1f}">'
                     f'<animate attributeName="stroke-dashoffset" values="{ln:.1f};{ln:.1f};0;0" '
                     f'keyTimes="0;{t / cycle:.4f};{(t + 0.5) / cycle:.4f};1" dur="{cycle}s" repeatCount="indefinite"/>'
                     f'</line>')
    for k, (x, y, label, t) in gn.items():
        s.append(f'<circle cx="{x}" cy="{y}" r="5" fill="#30363d"/>')
        if t is not None:
            s.append(f'<circle cx="{x}" cy="{y}" r="6" fill="{GREEN}" opacity="0">{window(t, cycle - 0.5, cycle)}</circle>')
        ly = y + 18 if k in ("cal", "fuji") else y + 4      # sop labels sit under their node, clear of the edges
        lx = x - 30 if k in ("cal", "fuji") else x + 10
        s.append(f'<text x="{lx}" y="{ly}" {FONT} font-size="10" fill="{TEXT if t else MUTED}">{esc(label)}</text>')
    s.append(f'<text x="{rx}" y="{H - 18}" {FONT} font-size="10" fill="{MUTED}">real nodes and edges from knowledge_graph.yaml · walk illustrative</text>')
    s.append('</svg>')
    write("retrieval.svg", "\n".join(s) + "\n")


# ── latency charts ───────────────────────────────────────────────────────────
DB = Path(__file__).resolve().parents[2] / "logs" / "ai_logs.db"
MODEL = "qwen3:1.7b"
SERIES = [("load", "#3987e5"), ("prefill", "#d95926"), ("generation", "#199e70")]  # validated on BG
GRID = "#21262d"


def runs():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    q = ("select time_to_first_token_ms, load_ms, prefill_ms, generation_ms, prompt_token_count "
         "from model_logs where model_name=? and source=? and status='ok' and time_to_first_token_ms is not null "
         "and load_ms is not null")
    return {src: con.execute(q, (MODEL, src)).fetchall() for src in ("benchmark", "chat")}


def ttft_chart(data):
    w, h, x0, x1 = W, 250, 250, W - 40
    vmax = 35
    sx = lambda ms: x0 + (ms / 1000) / vmax * (x1 - x0)
    s = card(w, h, f"Time to first token for {MODEL}: benchmark runs vs live chat turns, against the 3 second target", "daedalus — latency")
    s.append(f'<text x="24" y="60" {FONT} font-size="14" fill="{TEXT}">time to first token · {MODEL} · '
             'RTX 3050 Laptop, 4 GB VRAM</text>')
    base = 196
    for v in range(0, vmax + 1, 5):
        x = sx(v * 1000)
        s.append(f'<line x1="{x:.1f}" y1="82" x2="{x:.1f}" y2="{base}" stroke="{GRID}"/>')
        s.append(f'<text x="{x:.1f}" y="{base + 18}" {FONT} font-size="11" fill="{MUTED}" text-anchor="middle">{v} s</text>')
    tx = sx(3000)
    s.append(f'<line x1="{tx:.1f}" y1="78" x2="{tx:.1f}" y2="{base}" stroke="{TEXT}" stroke-dasharray="4 4"/>')
    s.append(f'<text x="{tx + 6:.1f}" y="88" {FONT} font-size="11" fill="{TEXT}">target &lt; 3 s</text>')
    rows = [("benchmark", "benchmark, ~2.2k-token prompt"), ("chat", "live chat turns")]
    for i, (key, label) in enumerate(rows):
        y = 118 + i * 52
        vals = sorted(r[0] for r in data[key])
        med = statistics.median(vals)
        s.append(f'<text x="24" y="{y + 4}" {FONT} font-size="12" fill="{TEXT}">{label}</text>')
        s.append(f'<text x="24" y="{y + 20}" {FONT} font-size="11" fill="{MUTED}">n={len(vals)} · median {med / 1000:.1f} s</text>')
        for v in vals:
            s.append(f'<circle cx="{sx(v):.1f}" cy="{y}" r="5" fill="{GREEN}" fill-opacity=".85" stroke="{BG}" stroke-width="2"/>')
        s.append(f'<line x1="{sx(med):.1f}" y1="{y - 12}" x2="{sx(med):.1f}" y2="{y + 12}" stroke="{TEXT}" stroke-width="2"/>')
    s.append(f'<text x="24" y="{h - 14}" {FONT} font-size="11" fill="{MUTED}">each dot is one run · '
             'white tick = median · source: model_logs in the audit db</text>')
    s.append('</svg>')
    Path(__file__).with_name("ttft.svg").write_text("\n".join(s) + "\n", encoding="utf-8")


def bar(x, y, w, h, fill, round_right):
    if not round_right or w < 8:
        return f'<rect x="{x:.1f}" y="{y}" width="{max(w, 0):.1f}" height="{h}" fill="{fill}"/>'
    r = 4
    return (f'<path d="M{x:.1f} {y}h{w - r:.1f}a{r} {r} 0 0 1 {r} {r}v{h - 2 * r}a{r} {r} 0 0 1 -{r} {r}'
            f'h-{w - r:.1f}z" fill="{fill}"/>')


def phases_chart(data):
    w, h, x0, x1 = W, 230, 250, W - 40
    means = {k: [statistics.mean(r[j] for r in data[k]) for j in (1, 2, 3)] for k in data}
    vmax = 25
    scale = (x1 - x0) / (vmax * 1000)
    s = card(w, h, "Mean time per phase for one answer, benchmark vs live chat: generation dominates, prefill stays small", "daedalus — latency")
    s.append(f'<text x="24" y="60" {FONT} font-size="14" fill="{TEXT}">where an answer\'s time goes · mean per phase</text>')
    lx = 24
    for name, col in SERIES:   # legend, one row above the plot
        s.append(f'<rect x="{lx}" y="76" width="10" height="10" rx="2" fill="{col}"/>')
        s.append(f'<text x="{lx + 16}" y="85" {FONT} font-size="11" fill="{TEXT}">{name}</text>')
        lx += 16 + len(name) * 7 + 22
    base = 182
    for v in range(0, vmax + 1, 5):
        x = x0 + v * 1000 * scale
        s.append(f'<line x1="{x:.1f}" y1="100" x2="{x:.1f}" y2="{base}" stroke="{GRID}"/>')
        s.append(f'<text x="{x:.1f}" y="{base + 18}" {FONT} font-size="11" fill="{MUTED}" text-anchor="middle">{v} s</text>')
    for i, (key, label) in enumerate([("benchmark", "benchmark (128 tokens out)"), ("chat", "live chat turns")]):
        y = 112 + i * 36
        s.append(f'<text x="24" y="{y + 15}" {FONT} font-size="12" fill="{TEXT}">{label}</text>')
        x = x0
        parts = means[key]
        for j, ((name, col), ms) in enumerate(zip(SERIES, parts)):
            wd = ms * scale
            s.append(bar(x, y, wd - (2 if j < 2 else 0), 22, col, j == 2))
            x += wd
        s.append(f'<text x="{x + 8:.1f}" y="{y + 15}" {FONT} font-size="11" fill="{TEXT}">'
                 f'{sum(parts) / 1000:.1f} s</text>')
    s.append(f'<text x="24" y="{h - 14}" {FONT} font-size="11" fill="{MUTED}">generation includes every output token; '
             'chat answers are longer than the benchmark\'s fixed 128</text>')
    s.append('</svg>')
    Path(__file__).with_name("phases.svg").write_text("\n".join(s) + "\n", encoding="utf-8")
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
            print(f"{k}: n={len(v)} ttft median={statistics.median(v):.0f} min={v[0]} max={v[-1]} "
                  f"phase means(load,prefill,gen)={[round(m) for m in means[k]]}")
    else:
        print(f"skipped charts: {DB} not found")
