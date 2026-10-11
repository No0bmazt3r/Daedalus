"""Generate the README's SVGs:

- banner.svg    animated terminal boot: a block labyrinth, Ariadne's thread,
                DAEDALUS in ANSI Shadow, then boot checks
- pipeline.svg  animated walk of one real chat turn through the pipeline
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


# ── pipeline.svg ─────────────────────────────────────────────────────────────
# One real turn, copied from Ariadne's Thread (q_20261011_111807373513).
STAGES = [
    ("question", "what is the current co2 concentration and reactor temperature?"),
    ("intent", "live_status"),
    ("safety guard", "not a control request → continue"),
    ("tools", "get_live_reading ×2 → co2_ppm 488.5 · temp_c 31.74  (1 ms)"),
    ("evidence pack", "2 labelled lines: [S1] co2_ppm  [S2] temp_c"),
    ("model", "qwen3:1.7b via ollama, on this machine · 38.3 s"),
    ("validator", "every number found in the evidence → grounded"),
    ("answer", "co2 is 488.5 ppm [S1], temperature 31.74 °C [S2]"),
]
TEXT, MUTED = "#c9d1d9", "#8b949e"


def card(w, h, title):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-label="{title}">',
            f'<rect width="{w}" height="{h}" rx="10" fill="{BG}"/>',
            f'<path d="M0 10a10 10 0 0 1 10-10h{w - 20}a10 10 0 0 1 10 10v20H0z" fill="{BAR}"/>',
            *[f'<circle cx="{20 + i * 18}" cy="15" r="5.5" fill="{c}"/>'
              for i, c in enumerate(["#ff5f57", "#febc2e", "#28c840"])]]


def pulse(at, cycle, hold=0.3):
    """Opacity that switches on at `at`, holds, and resets before the loop repeats."""
    k = [0, at / cycle, (at + hold) / cycle, (cycle - 0.8) / cycle, 1]
    return (f'<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="{";".join(f"{x:.3f}" for x in k)}" '
            f'dur="{cycle}s" repeatCount="indefinite"/>')


def pipeline():
    row, top, step = 44, 92, 1.3
    cycle = 2 + len(STAGES) * step + 3
    H = top + len(STAGES) * row + 56
    s = card(W, H, "How Daedalus answers: a question passes intent, a safety guard, deterministic tools, "
                   "an evidence pack, the local model and a validator before the cited answer is shown")
    s.append(f'<text x="{W // 2}" y="19" fill="{MUTED}" {FONT} font-size="12" text-anchor="middle">'
             'daedalus — how one question is answered</text>')
    s.append(f'<text x="24" y="62" {FONT} font-size="14" fill="{MUTED}">you@daedalus:~$ '
             f'<tspan fill="{GREEN}">trace q_20261011_111807373513</tspan></text>')
    # rail behind the stage boxes, and a packet riding it
    x_box, w_box = 24, 196
    rail_x = x_box + 14
    s.append(f'<line x1="{rail_x}" y1="{top + 17}" x2="{rail_x}" y2="{top + (len(STAGES) - 1) * row + 17}" '
             f'stroke="#30363d" stroke-width="2"/>')
    for i, (name, detail) in enumerate(STAGES):
        y = top + i * row
        at = 1 + i * step
        s.append(f'<rect x="{x_box}" y="{y}" width="{w_box}" height="34" rx="6" fill="{BAR}" stroke="#30363d"/>')
        s.append(f'<rect x="{x_box}" y="{y}" width="{w_box}" height="34" rx="6" fill="#12261a" '
                 f'stroke="{GREEN}" opacity="0">{pulse(at, cycle)}</rect>')
        s.append(f'<circle cx="{rail_x}" cy="{y + 17}" r="4" fill="#30363d"/>')
        s.append(f'<circle cx="{rail_x}" cy="{y + 17}" r="4" fill="{GREEN}" opacity="0">{pulse(at, cycle)}</circle>')
        s.append(f'<text x="{rail_x + 16}" y="{y + 22}" {FONT} font-size="13" fill="{TEXT}">'
                 f'<tspan fill="{MUTED}">{i + 1:02d}</tspan>  {name}</text>')
        fill = GREEN if i == len(STAGES) - 1 else TEXT
        s.append(f'<g opacity="0">{pulse(at + 0.25, cycle)}'
                 f'<text x="{x_box + w_box + 28}" y="{y + 22}" {FONT} font-size="13" fill="{MUTED}">&gt; '
                 f'<tspan fill="{fill}">{detail}</tspan></text></g>')
    # the branch a control request takes
    y = top + 2 * row
    s.append(f'<g opacity="0">{pulse(1 + 2 * step + 0.6, cycle)}<text x="{x_box + w_box + 28}" y="{y + 36}" '
             f'{FONT} font-size="11" fill="{THREAD}">  "open valve ABV-1" would stop here: refused, no tool, no model call</text></g>')
    s.append(f'<text x="24" y="{H - 22}" {FONT} font-size="12" fill="{MUTED}">every step is logged on one '
             'query_id and replayable in ariadne\'s thread</text>')
    s.append('</svg>')
    Path(__file__).with_name("pipeline.svg").write_text("\n".join(s) + "\n", encoding="utf-8")


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
    s = card(w, h, f"Time to first token for {MODEL}: benchmark runs vs live chat turns, against the 3 second target")
    s.append(f'<text x="{W // 2}" y="19" fill="{MUTED}" {FONT} font-size="12" text-anchor="middle">daedalus — latency</text>')
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
    s = card(w, h, "Mean time per phase for one answer, benchmark vs live chat: generation dominates, prefill stays small")
    s.append(f'<text x="{W // 2}" y="19" fill="{MUTED}" {FONT} font-size="12" text-anchor="middle">daedalus — latency</text>')
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
    pipeline()
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
