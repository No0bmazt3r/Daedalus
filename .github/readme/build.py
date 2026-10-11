"""Generate banner.svg: an animated terminal boot. Types a command, prints a
block-character labyrinth row by row, runs Ariadne's thread to its centre,
drops in DAEDALUS (ANSI Shadow), then prints boot checks. Everything is drawn
as shapes, so it never depends on the viewer's font.

    python3 .github/readme/build.py
"""
import random
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


if __name__ == "__main__":
    build()
