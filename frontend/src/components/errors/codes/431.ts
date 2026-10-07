import type { ErrorInfo } from '../types'

export default {
  name: 'Request Header Fields Too Large', title: 'Too many seals on the letter',
  myth: 'The letter carried so many stamps the gate would not take it.',
  block: 'Too many enchantments on one item.',
  what: "The request's headers, often cookies, are too large.",
  fix: "Clear this site's cookies, then try again.",
  art: [
    '............', 'tttttttttttt', 'traawwrraawt', 'trrwwaawwrrt',
    'taawwrraawwt', 't.tt....tt.t', 't...tttt...t', 't..........t',
    't..........t', 'tttttttttttt', '............', '............',
  ],
  css: `
/* 431 — the stamps flash one after another */
.pix-431 .px-r, .pix-431 .px-w, .pix-431 .px-a { animation: pix-pulse 1.4s ease-in-out infinite; animation-delay: calc(var(--x) * 0.1s); }
`,
} satisfies ErrorInfo
