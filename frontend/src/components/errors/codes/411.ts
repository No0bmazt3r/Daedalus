import type { ErrorInfo } from '../types'

export default {
  name: 'Length Required', title: 'How long is the thread?',
  myth: 'Ariadne has to know the length before she spins it.',
  block: 'The crafting table needs to know the stack size.',
  what: "The server needs to know the request's size up front (Content-Length).",
  fix: 'Send the request with its length set. The browser normally does this for you.',
  art: [
    '............', '............', '..aa........', '.aaaa.......',
    '.aaaa.......', '..aa........', '............', 'tttttttttttt',
    't.m.m.m.m.mt', 't.m.m.m.m.mt', 'tttttttttttt', '............',
  ],
  css: `
/* 411 — the ruler is measured tick by tick */
.pix-411 .px-m { animation: pix-pulse 1.8s ease-in-out infinite; animation-delay: calc(var(--x) * 0.15s); }
.pix-411 .px-a { animation: pix-wiggle 1.4s ease-in-out infinite; }
`,
} satisfies ErrorInfo
