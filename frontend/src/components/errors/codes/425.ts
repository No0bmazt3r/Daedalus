import type { ErrorInfo } from '../types'

export default {
  name: 'Too Early', title: 'The wax is still warm',
  myth: 'Icarus tried the wings before the wax had set.',
  block: 'The crops have not grown yet.',
  what: 'The server will not risk handling a request sent this early (replay protection).',
  fix: 'Wait a moment, then send it again.',
  art: [
    '............', '............', '.....gg.....', '....gggg....',
    '...gg.gg....', '.....g......', '....gg......', '.....g......',
    '.....g......', '..mmmmmmmm..', '..mmmmmmmm..', '............',
  ],
  css: `
/* 425 — the sapling grows, then starts over */
.pix-425 .px-g { transform-origin: 50% 100%; animation: pix-grow 3s ease-out infinite; animation-delay: calc((11 - var(--y)) * 0.12s); }
`,
} satisfies ErrorInfo
