import type { ErrorInfo } from '../types'

export default {
  name: 'Unprocessable Entity', title: 'Crafted wrong',
  myth: 'The wings were built, but with the feathers backwards.',
  block: 'The right items, in the wrong slots.',
  what: 'The request was readable, but some values failed validation.',
  fix: 'Check each field against what is expected, then resend.',
  art: Array.from({ length: 13 }, (_, i) =>
    Array.from({ length: 13 }, (_, j) => {
      if (i % 4 === 0 || j % 4 === 0) return 't'
      const cell = Math.floor(i / 4) * 3 + Math.floor(j / 4)
      return cell === 4 ? 'r' : cell % 2 === 0 ? 'a' : '.'
    }).join(''),
  ),
  css: `
/* 422 — the crafting grid lights up slot by slot; the wrong slot blinks */
.pix-422 .px-a { animation: pix-pulse 2s ease-in-out infinite; animation-delay: calc((var(--x) + var(--y)) * 0.08s); }
.pix-422 .px-r { animation: pix-glint 0.9s steps(1) infinite; }
`,
} satisfies ErrorInfo
