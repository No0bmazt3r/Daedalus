"""The startup banner: a labyrinth, Ariadne's thread, and DAEDALUS.

Printed by `daedalus.sh dev` / `start`. The labyrinth prints row by row, the
letters drop in, then the thread runs from the entrance to the centre. Stdlib
only; the README banner (`.github/readme/build.py`) imports `GLYPHS` and
`maze()` from here, so the two always draw the same labyrinth.

Skipped (prints nothing) when stdout is not a terminal, when it is narrower
than the banner (it would wrap), or when NO_COLOR or DAEDALUS_NO_BANNER is set.

    python3 scripts/banner.py
"""
from __future__ import annotations

import os
import random
import shutil
import sys
import time
from collections import deque

GLYPHS = {
    "D": ["██████╗ ", "██╔══██╗", "██║  ██║", "██║  ██║", "██████╔╝", "╚═════╝ "],
    "A": [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
    "E": ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
    "L": ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
    "U": ["██╗   ██╗", "██║   ██║", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
    "S": ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
}
WORD = "DAEDALUS"
TAGLINE = "fully local · read-only · grounded answers"


def maze(n: int = 7, seed: int = 7) -> tuple[list[list[bool]], list[tuple[int, int]]]:
    """Fixed-seed DFS maze on a (2n+1)² grid, open at the bottom-left, and the
    BFS route (col, row) from that opening to the centre room."""
    g = 2 * n + 1
    wall = [[True] * g for _ in range(g)]
    rng, stack = random.Random(seed), [(0, 0)]
    wall[1][1] = False
    while stack:
        x, y = stack[-1]
        nxt = [(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
               if 0 <= x + dx < n and 0 <= y + dy < n and wall[2 * (y + dy) + 1][2 * (x + dx) + 1]]
        if not nxt:
            stack.pop()
            continue
        nx, ny = rng.choice(nxt)
        wall[y + ny + 1][x + nx + 1] = wall[2 * ny + 1][2 * nx + 1] = False
        stack.append((nx, ny))
    start, goal = (1, g - 1), (n, n)
    wall[g - 1][1] = False
    prev, q = {start: None}, deque([start])
    while q:
        c = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nb = (c[0] + dx, c[1] + dy)
            if 0 <= nb[0] < g and 0 <= nb[1] < g and not wall[nb[1]][nb[0]] and nb not in prev:
                prev[nb] = c
                q.append(nb)
    route, c = [], goal
    while c:
        route.append(c)
        c = prev[c]
    return wall, route[::-1]


# ── terminal rendering ───────────────────────────────────────────────────────
GREEN, SHADOW, RED, DIM = (63, 185, 80), (31, 111, 43), (255, 123, 114), (139, 148, 158)
RESET = "\x1b[0m"


def fg(c):
    return f"\x1b[38;2;{c[0]};{c[1]};{c[2]}m"


def bg(c):
    return f"\x1b[48;2;{c[0]};{c[1]};{c[2]}m"


def frame(wall, thread, rows_shown, letters_shown):
    """One frame as text lines. Each terminal row holds two maze rows (▀ with
    foreground = top, background = bottom), so the cells come out square."""
    g = len(wall)
    lit = set(thread)

    def cell(x, y):
        if y >= rows_shown or y >= g:
            return None
        if (x, y) in lit:
            return RED
        return GREEN if wall[y][x] else None

    maze_lines = []
    for r in range(0, g, 2):
        line = ""
        for x in range(g):
            top, bot = cell(x, r), cell(x, r + 1)
            if top is None and bot is None:
                line += " "
            elif bot is None:
                line += fg(top) + "▀" + RESET
            elif top is None:
                line += fg(bot) + "▄" + RESET
            else:
                line += fg(top) + bg(bot) + "▀" + RESET
        maze_lines.append(line)

    word = []
    for r in range(6):
        line = ""
        for i, ch in enumerate(WORD):
            glyph = GLYPHS[ch][r]
            if i >= letters_shown:
                line += " " * len(glyph)
                continue
            for c in glyph:
                line += (fg(GREEN) + c if c == "█" else fg(SHADOW) + c if c != " " else c)
        word.append(line + RESET)

    top = (len(maze_lines) - 6) // 2           # word centred against the maze
    out = []
    for i, m in enumerate(maze_lines):
        w = word[i - top] if 0 <= i - top < 6 else ""
        out.append(f"  {m}   {w}")
    return out


def main() -> None:
    if not sys.stdout.isatty() or os.environ.get("NO_COLOR") or os.environ.get("DAEDALUS_NO_BANNER"):
        return
    wall, route = maze()
    g = len(wall)
    if shutil.get_terminal_size().columns < 2 + g + 3 + sum(len(GLYPHS[c][0]) for c in WORD):
        return
    height = (g + 1) // 2
    w = sys.stdout.write

    def draw(rows, letters, steps, first=False):
        lines = frame(wall, route[:steps], rows, letters)
        if not first:
            w(f"\x1b[{height}A")                # back to the top of the banner
        w("\n".join("\x1b[2K" + ln for ln in lines) + "\n")
        sys.stdout.flush()

    w("\x1b[?25l")                              # hide the cursor while animating
    try:
        draw(0, 0, 0, first=True)
        for r in range(1, g + 1):               # the labyrinth, row by row
            draw(r, min(len(WORD), r * len(WORD) // g), 0)
            time.sleep(0.035)
        for s in range(1, len(route) + 1):      # Ariadne's thread to the centre
            draw(g, len(WORD), s)
            time.sleep(0.025)
        w(f"\n  {fg(DIM)}{TAGLINE}{RESET}\n")
    except KeyboardInterrupt:
        pass
    finally:
        w("\x1b[?25h" + RESET)
        sys.stdout.flush()


if __name__ == "__main__":
    main()
