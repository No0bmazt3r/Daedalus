import type { ErrorInfo } from '../types'

export default {
  name: 'Conflict', title: 'Two paths, one corridor',
  myth: 'Two heroes reached the same door at once.',
  block: 'Something is already built on this block.',
  what: 'The request clashes with the current state, like a duplicate or a change made meanwhile.',
  fix: 'Refresh to see the latest state, then try again.',
  art: [
    't..........t', '.t........t.', '..t......t..', '...t....t...',
    '....t..t....', '.....tt.....', '.....tt.....', '....t..t....',
    '.mmt....tmm.', '..m......m..', '.m........m.', '............',
  ],
  css: `
/* 409 — the blades clash */
.pix-409 { animation: pix-clash 1.8s ease-in-out infinite; }
.pix-409 .px-t { animation: pix-glint 1.8s steps(1) infinite; animation-delay: -0.8s; }
`,
} satisfies ErrorInfo
