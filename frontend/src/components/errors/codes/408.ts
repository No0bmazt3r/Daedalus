import type { ErrorInfo } from '../types'

export default {
  name: 'Request Timeout', title: 'The torch burned out',
  myth: 'You waited so long in the maze that the torch went dark.',
  block: 'The chunk unloaded while you were away.',
  what: 'The server gave up waiting for the rest of the request.',
  fix: 'Try again. For a large upload, check the connection and send it again.',
  art: [
    '.....ww.....', '....wwww....', '....wrrw....', '.....rr.....',
    '.....tt.....', '.....mm.....', '.....mm.....', '.....mm.....',
    '.....mm.....', '.....mm.....', '.....mm.....', '............',
  ],
  css: `
/* 408 — the torch burns down to nothing, then catches again */
.pix-408 .px-w, .pix-408 .px-r { transform-origin: 50% 100%; animation: pix-burnout 3.5s ease-in infinite; }
.pix-408 .px-r { animation-delay: -0.2s; }
`,
} satisfies ErrorInfo
