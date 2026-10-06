import type { ErrorInfo } from '../types'

export default {
  name: 'Bad Request', title: 'The thread is tangled',
  myth: "Ariadne's thread came back in knots.",
  block: 'That recipe is not in any crafting book.',
  what: 'The request was malformed, so the server could not read it.',
  fix: 'Check what was sent, fix the input, and try again.',
  art: [
    '............', '.aaa....aaa.', 'a...a..a...a', 'a....aa....a',
    '.a...aa...a.', '..aaa..aaa..', '....a..a....', '...a....a...',
    '..a......a..', '.a........a.', 'a..........a', '............',
  ],
  css: `
/* 400 — the tangled thread wiggles, a wave running along it */
.pix-400 .px-a { animation: pix-wiggle 1.6s ease-in-out infinite; animation-delay: calc(var(--x) * -0.13s); }
`,
} satisfies ErrorInfo
