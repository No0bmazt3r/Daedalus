"""Generate banner.svg: an animated terminal that types a command, then drops in
DAEDALUS in ANSI Shadow, drawn as shapes so it never depends on the viewer's font.

    python3 .github/readme/build.py
"""
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
TAGLINE = "fully local · read-only · grounded answers"

CW, CH = 12, 22                   # one character cell
BG, BAR = "#0d1117", "#161b22"
GREEN, SHADOW, DIM = "#3fb950", "#1f6f2b", "#8b949e"
W = 860
TYPE_START, TYPE_STEP = 0.4, 0.07  # seconds
LETTER_STEP = 0.12

# box-drawing char -> line segments in cell units (0..1), centre is 0.5
SEG = {
    "═": [(0, .5, 1, .5)], "║": [(.5, 0, .5, 1)],
    "╗": [(0, .5, .5, .5), (.5, .5, .5, 1)], "╔": [(.5, .5, 1, .5), (.5, .5, .5, 1)],
    "╝": [(0, .5, .5, .5), (.5, .5, .5, 0)], "╚": [(.5, .5, 1, .5), (.5, .5, .5, 0)],
}


def letter(ch, x0, y0):
    out = []
    for r, row in enumerate(GLYPHS[ch]):
        for c, g in enumerate(row):
            x, y = x0 + c * CW, y0 + r * CH
            if g == "█":
                out.append(f'<rect x="{x}" y="{y}" width="{CW}" height="{CH}" fill="{GREEN}"/>')
            for a, b, cx, d in SEG.get(g, []):
                out.append(f'<line x1="{x + a * CW}" y1="{y + b * CH}" x2="{x + cx * CW}" '
                           f'y2="{y + d * CH}" stroke="{SHADOW}" stroke-width="2.5"/>')
    return out


def build():
    cols = sum(len(GLYPHS[c][0]) for c in WORD)
    art_x = (W - cols * CW) // 2
    art_y, H = 92, 92 + 6 * CH + 70
    typed_end = TYPE_START + len(CMD) * TYPE_STEP
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
         f'role="img" aria-label="Daedalus — {TAGLINE}">',
         '<defs><filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b"/>'
         '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>',
         f'<rect width="{W}" height="{H}" rx="10" fill="{BG}"/>',
         f'<path d="M0 10a10 10 0 0 1 10-10h{W - 20}a10 10 0 0 1 10 10v20H0z" fill="{BAR}"/>']
    s += [f'<circle cx="{20 + i * 18}" cy="15" r="5.5" fill="{c}"/>'
          for i, c in enumerate(["#ff5f57", "#febc2e", "#28c840"])]
    s.append(f'<text x="{W // 2}" y="19" fill="{DIM}" font-family="monospace" font-size="12" '
             'text-anchor="middle">daedalus — bash</text>')

    # prompt, then the command revealed by a growing clip; textLength pins every
    # character to exactly CHAR px so the cursor lands where the text ends
    prompt, char = "you@daedalus:~$ ", 9.6
    cmd_x, cmd_w = 24 + len(prompt) * char, len(CMD) * char
    s.append(f'<text x="24" y="62" font-family="monospace" font-size="16" fill="{DIM}" '
             f'xml:space="preserve" textLength="{len(prompt) * char}">{prompt}</text>')
    s.append(f'<clipPath id="typed"><rect x="{cmd_x}" y="40" height="30" width="0">'
             f'<animate attributeName="width" values="' + ";".join(
                 f"{i * char:.1f}" for i in range(len(CMD) + 1)) +
             f'" calcMode="discrete" begin="{TYPE_START}s" dur="{typed_end - TYPE_START:.2f}s" '
             f'fill="freeze"/></rect></clipPath>')
    s.append(f'<text x="{cmd_x}" y="62" font-family="monospace" font-size="16" fill="{GREEN}" '
             f'textLength="{cmd_w}" clip-path="url(#typed)">{CMD}</text>')
    s.append(f'<rect y="48" width="9" height="18" fill="{GREEN}" x="{cmd_x}">'
             f'<animate attributeName="x" values="' + ";".join(
                 f"{cmd_x + i * char:.1f}" for i in range(len(CMD) + 1)) +
             f'" calcMode="discrete" begin="{TYPE_START}s" dur="{typed_end - TYPE_START:.2f}s" fill="freeze"/>'
             '<animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></rect>')

    # letters drop in one by one, with a glow
    s.append('<g filter="url(#glow)">')
    x = art_x
    for i, ch in enumerate(WORD):
        b = typed_end + 0.3 + i * LETTER_STEP
        s.append(f'<g opacity="0"><animate attributeName="opacity" from="0" to="1" begin="{b:.2f}s" '
                 f'dur="0.25s" fill="freeze"/><animateTransform attributeName="transform" type="translate" '
                 f'from="0 -18" to="0 0" begin="{b:.2f}s" dur="0.3s" fill="freeze"/>')
        s += letter(ch, x, art_y)
        s.append('</g>')
        x += len(GLYPHS[ch][0]) * CW
    s.append('</g>')

    done = typed_end + 0.3 + len(WORD) * LETTER_STEP + 0.2
    s.append(f'<text x="{W // 2}" y="{H - 26}" font-family="monospace" font-size="15" fill="{DIM}" '
             f'text-anchor="middle" opacity="0">{TAGLINE}<animate attributeName="opacity" from="0" '
             f'to="1" begin="{done:.2f}s" dur="0.6s" fill="freeze"/></text>')
    s.append('</svg>')
    Path(__file__).with_name("banner.svg").write_text("\n".join(s) + "\n", encoding="utf-8")


if __name__ == "__main__":
    build()
