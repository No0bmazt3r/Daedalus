import type { ErrorInfo } from '../types'

export default {
  name: 'URI Too Long', title: 'The scroll would not fit',
  myth: 'The message was longer than any messenger could carry.',
  block: 'The sign ran out of room for letters.',
  what: 'The address is too long for the server to read.',
  fix: 'Shorten the link, or send the data in the request body instead.',
  art: [
    '............', '............', 'mm..........', 'mwwwwwwwwwww',
    'mwttwtttwttw', 'mwwwwwwwwwww', 'mwtttwttwtww', 'mwwwwwwwwwww',
    'mm..........', '............', '............', '............',
  ],
  css: `
/* 414 — the scroll keeps unrolling */
.pix-414 .px-t, .pix-414 .px-w { animation: pix-flow 1.4s ease-in-out infinite; animation-delay: calc(var(--x) * -0.12s); }
`,
} satisfies ErrorInfo
