import type { ErrorInfo } from '../types'

export default {
  name: 'Misdirected Request', title: 'The letter went to the wrong island',
  myth: 'The messenger sailed to Crete, but the letter was for Athens.',
  block: 'You stepped through the wrong portal.',
  what: 'The request reached a server that cannot answer for this address.',
  fix: 'Usually a proxy or DNS setup issue. Retry, or check the address.',
  art: [
    '.mmmmmmmmmm.', '.m........m.', '.m.aaaaaa.m.', '.m.a....a.m.',
    '.m.a.aa.a.m.', '.m.a.aa.a.m.', '.m.a....a.m.', '.m.aaaaaa.m.',
    '.m........m.', '.m........m.', '.mmmmmmmmmm.', '............',
  ],
  css: `
/* 421 — the portal swirls */
.pix-421 .px-a { animation: pix-pulse 1.6s ease-in-out infinite; animation-delay: calc((var(--x) + var(--y)) * 0.1s); }
`,
} satisfies ErrorInfo
