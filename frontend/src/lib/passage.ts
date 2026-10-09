/**
 * Passage text as stored comes straight out of PDF extraction, so it carries
 * the PDF's line breaks: "…responsible for the primary function of\nthe amine:
 * absorb…". Read as-is it breaks mid-sentence every line. This joins those
 * back into paragraphs, keeping the breaks that mean something: a blank line,
 * a list item or an "Equation" line, and the line after a colon.
 *
 * Display only. The stored text, and what was embedded, are untouched.
 */
const KEEP_BEFORE = /^(?:\d+[.)]\s|[-•*–]\s|Equation\b|Table\b|Figure\b)/

export function reflowPassage(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((para) => {
      const lines = para.split('\n').map((l) => l.trim()).filter(Boolean)
      let out = ''
      for (const line of lines) {
        if (!out) out = line
        else if (KEEP_BEFORE.test(line) || /:$/.test(out)) out += `\n${line}`
        // A word hyphenated across the break is rejoined without the hyphen.
        else if (/[a-z]-$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line
        else out += ` ${line}`
      }
      return out.replace(/[ \t]{2,}/g, ' ')
    })
    .filter(Boolean)
}
