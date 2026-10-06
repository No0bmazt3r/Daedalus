import type { ErrorInfo } from '../types'

export default {
  name: 'Gateway Timeout', title: 'The message never came back',
  myth: 'The runner went into the maze and has not returned.',
  block: 'The sand ran out before the redstone fired.',
  what: 'A server waited too long for another one to answer.',
  fix: 'The backend may be slow or busy (a big model loading?). Try again shortly.',
  art: [
    'tttttttttttt', '.t........t.', '.twwwwwwwwt.', '..twwwwwwt..',
    '...twwwwt...', '....twwt....', '....t..t....', '...t.ww.t...',
    '..t..ww..t..', '.t..wwww..t.', '.twwwwwwwwt.', 'tttttttttttt',
  ],
  css: `
/* 504 — the sand runs out, the hourglass turns over */
.pix-504 { animation: pix-flip 5s ease-in-out infinite; }
.pix-504 .px-w { animation: pix-pulse 2.5s ease-in-out infinite; animation-delay: calc(var(--y) * -0.2s); }
`,
} satisfies ErrorInfo
