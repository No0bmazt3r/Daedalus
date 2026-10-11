# README Guideline (reverse-engineered from lyceum-v2)

A recipe for a "terminal-style" GitHub README: a generated banner, a neofetch-style
info card, shell-prompt section headings, and every claim backed by a real number.

---

## 1. The big idea

The whole README pretends to be **one terminal session**. Every section heading is
a shell command (`cat ./why`, `npm run dev`, `tree -L 2`) and the section body is
that command's "output". That one theme does three jobs:

- Gives the page a consistent visual identity with zero CSS (GitHub strips CSS).
- Makes headings self-describing: `npm run dev` *is* the "how to run" section.
- Feels like a developer tool, which matches the audience.

The second idea: **concrete numbers over adjectives.** Instead of "accurate",
it says "predicted 0.534 vs actual 0.536, mean error 0.009". The same handful
of headline numbers repeat in the card, the badges, the prose, the table and
the screenshot captions, so they stick.

---

## 2. Section order (top to bottom)

| # | Section | Heading used | Purpose |
|:-:|:--|:--|:--|
| 1 | Banner | (image) | Project name as ASCII-art, dark/light variants |
| 2 | Info card | (image) | neofetch-style fact sheet: stack, key stats |
| 3 | Badges | (links) | 3 badges max, each jumps to a section below |
| 4 | Hook | ` ```text ` block | `cat ./about` → 2-3 line pitch + one "proof" command |
| 5 | What it is | `open ./architecture` | 2 short paragraphs + architecture diagram |
| 6 | Why | `cat ./why` | 3-4 bold-lead bullets, each with a number |
| 7 | Worked example | `cat ./worked-example` | One real scenario as a 2-column table |
| 8 | Screenshots | `ls ./screens` | 2-column HTML table, captions above images |
| 9 | Architecture | `cat ./ARCHITECTURE` | Layer table in a text block + 3 bullets |
| 10 | Run it | `npm run dev` | Requirements line + commented command block |
| 11 | Tests | `npm run prove:all` | Each test command with its check count |
| 12 | Demo | `npm run smoke` | How to see it end-to-end |
| 13 | Layout | `tree -L 2` | Annotated folder tree |
| 14 | Related | `ls ../project*` | Table linking sibling versions/repos |
| 15 | License | `cat ./LICENSE` | Short license statement + link |
| 16 | Footer | `<sub>` | How the README art is generated |

Rule of thumb: **pitch → proof → pictures → internals → how to run → housekeeping.**
A visitor who stops after section 6 still knows what it is and why it matters.

---

## 3. Techniques, with copy-paste snippets

### 3.1 Dark/light-aware images
GitHub serves the right image for the viewer's theme via `<picture>`:

```html
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)"  srcset=".github/readme/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/readme/banner-light.svg">
    <img src=".github/readme/banner-dark.svg" alt="MY PROJECT" width="850">
  </picture>
</div>
```

- Fixed `width="850"` (fits GitHub's content column).
- The `<img>` fallback is the dark variant.
- Keep README assets in `.github/readme/` so they don't clutter the root.

### 3.2 Banner + info card as generated SVG
Both images are SVGs produced by a stdlib-only Python script
(`.github/readme/build.py`). Inputs:
- `banner.txt` — the name in the figlet **ANSI Shadow** font (`figlet -f "ANSI Shadow" "MY PROJECT"`, or any online figlet generator).
- `art.txt` — braille-character art (make with any "image to braille" converter).
- A config block at the top: `NAME`, `THEMES` (colors per theme), `PROMPT_USER`,
  `PROMPT_CMD`, `TAGLINE`, `GROUPS` (label/value rows), `FOOTER`, `CARD_LABEL`.

Card layout: braille art on the left, on the right a fake prompt with a
blinking cursor (`<animate>`), an italic tagline, a rule, grouped `label  value`
rows, a color-swatch bar, and a green `[ ok ]` footer line.

To reuse: copy `build.py`, edit the config block, replace the two `.txt` files,
run `python3 .github/readme/build.py`, commit the SVGs.

### 3.3 Accessible alt text that carries the facts
The card's `alt`/`aria-label` is a full sentence with all the key numbers, so
screen readers (and anyone with images off) get the same information:

```html
alt="MyProject, a <one-line description>: <stat 1>, <stat 2>, <stat 3>"
```

Every screenshot alt also describes *what the screen proves*, not just "screenshot".

### 3.4 Badges that are navigation, not decoration
Only 3 badges, `for-the-badge` style, dark label color, each linking to a section:

```html
<p align="center">
  <a href="#user-myproj-npm-run-dev"><img src="https://img.shields.io/badge/run_it-locally,_no_keys-7aa9e8?style=for-the-badge&labelColor=161b22" alt="run it: locally, no keys"></a>
  <a href="#user-myproj-npm-test"><img src="https://img.shields.io/badge/tests-56_passing-3fb950?style=for-the-badge&labelColor=161b22" alt="tests: 56 passing"></a>
</p>
```

Shields syntax: `_` = space, `--` = literal dash, `%3D` = `=`.
**Anchor slugs:** GitHub drops `@ : ~ $ . /` and turns spaces into `-`, so the
heading `hafiz@lyceum-v2:~$ npm run dev` becomes `#hafizlyceum-v2-npm-run-dev`.
Check by hovering the heading link on GitHub after pushing.

### 3.5 Shell-prompt headings
```markdown
### <samp>user@myproject:~$ cat ./why</samp>
```
`<samp>` renders monospace inside a heading. Use the same `user@project` prefix
everywhere and pick commands whose "output" matches the section content.

### 3.6 The hook block
Open with a fake terminal session in a ` ```text ` fence: an `about` blurb in
lowercase, then **one runnable command that reproduces a headline number**:

```text
user@myproject:~$ cat ./about
<what it does, in one breath>. <who it's for>. <the one-line differentiator>.

user@myproject:~$ <real command that prints a key result>
<the result>
```

### 3.7 "Why" bullets
Bold lead phrase + 1-3 lines, each containing something checkable
(a count, a measured value, a design guarantee):

```markdown
- **Grounded, and it proves it.** Every number traces down to ... `P = 0.43`.
```

### 3.8 Worked example as a table
One concrete scenario, two columns (`quantity | value`), left-aligned
(`|:--|:--|`). Better than a paragraph of claims.

### 3.9 Screenshot grid
HTML table, 2 columns, `width="50%"`, a `<samp>` caption row *above* each image
row. Captions are lowercase and include the number the screen shows
(`closed loop: mean error 0.009`). Number files in viewing order:
`docs/screenshots/01-login.png`, `02-…`.

### 3.10 Command blocks with inline comments
```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # production build into dist/
```
Align the `#` comments. Put a one-line **Requirements** sentence above
(runtime version, "no backend, no API keys").

### 3.11 Architecture as an aligned text table
```text
Layer 0   Data model   the contract everything obeys   src/types.ts
Layer 1   Core         pure logic, no I/O               src/lib/
Layer 2   UI           screens                          src/ui/
```
Columns: layer, name, one-phrase role, path. Then 2-3 bold-lead bullets for the
key concepts.

### 3.12 Related-repos table and footer
- Table of versions/sibling repos: `version | repo | what it is`.
- Footer in `<sub>` saying how the README images are generated, so future-you
  remembers.

---

## 4. Writing style rules observed

- **Lowercase** in terminal output, captions and the card; normal case in prose.
- **Short sentences.** Prose paragraphs are 2-4 lines, wrapped ~78 chars in source.
- **Numbers repeated consistently** — pick 3-5 headline figures and use the
  exact same values everywhere (card, badges, hook, table, captions).
- **Contrast phrases** for positioning: "A network, not a chain." "A measured
  cohort, not roleplay."
- **No fluff words** (no "blazing fast", "powerful", "seamless"). Show the measurement.
- Inline code (`` `0.534` ``) for values a reader might search or verify.

---

## 5. Blank template

````markdown
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/readme/banner-light.svg">
    <img src=".github/readme/banner-dark.svg" alt="PROJECT NAME" width="850">
  </picture>
</div>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/card-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/readme/card-light.svg">
    <img src=".github/readme/card-dark.svg" alt="FULL SENTENCE WITH KEY STATS" width="850">
  </picture>
</div>

<p align="center">
  <a href="#ANCHOR"><img src="https://img.shields.io/badge/LABEL-VALUE-7aa9e8?style=for-the-badge&labelColor=161b22" alt="LABEL: VALUE"></a>
</p>

```text
me@project:~$ cat ./about
one-breath description. who it is for. the differentiator.

me@project:~$ <command that prints a headline result>
<result>
```

### <samp>me@project:~$ open ./architecture</samp>

Two short paragraphs: what it is, what it's built on.

<p align="center"><img src="docs/screenshots/00-architecture.png" alt="..." width="850"></p>

### <samp>me@project:~$ cat ./why</samp>

- **Point one.** Evidence with a number.
- **Point two.** Evidence with a number.
- **Point three.** Evidence with a number.

### <samp>me@project:~$ cat ./worked-example</samp>

| quantity | value |
|:--|:--|
| ... | ... |

### <samp>me@project:~$ ls ./screens</samp>

<table>
  <tr><td width="50%"><samp>caption: number</samp></td><td width="50%"><samp>caption: number</samp></td></tr>
  <tr><td><img src="docs/screenshots/01-x.png" alt="..."></td><td><img src="docs/screenshots/02-y.png" alt="..."></td></tr>
</table>

### <samp>me@project:~$ npm run dev</samp>

Requirements: ...

```bash
npm install
npm run dev        # ...
```

### <samp>me@project:~$ npm test</samp>

```bash
npm test           # N checks
```

### <samp>me@project:~$ tree -L 2</samp>

```text
src/
  ...                what it is
```

### <samp>me@project:~$ cat ./LICENSE</samp>

License line. See [LICENSE](LICENSE).

<sub>Banner and card generated by <code>.github/readme/build.py</code>.</sub>
````

---

## 6. Checklist before publishing

- [ ] Banner + card exist in both `-dark.svg` and `-light.svg`.
- [ ] Every image has meaningful alt text (card alt includes the key stats).
- [ ] Badge links actually jump to their sections (test on GitHub).
- [ ] Headline numbers identical in card, badges, prose, table, captions.
- [ ] Every command in the README actually runs on a fresh clone.
- [ ] Screenshots numbered in viewing order, captions include what they prove.
- [ ] Page reads fine in both GitHub light and dark mode.
