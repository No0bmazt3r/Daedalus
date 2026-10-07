import type { ErrorInfo } from '../types'

export default {
  name: 'Precondition Required', title: 'Show your seal first',
  myth: "No one enters the workshop without the master's seal.",
  block: 'Place the right block first, then this one.',
  what: 'The server needs the request to carry a condition (like If-Match), so two changes cannot overwrite each other.',
  fix: 'Fetch the current version and send its tag along with the change.',
  art: [
    '....tttt....', '....tttt....', '.....tt.....', '.....tt.....',
    '...tttttt...', '..tttttttt..', '............', '...rrrrrr...',
    '..r......r..', '..r.rrrr.r..', '..r......r..', '...rrrrrr...',
  ],
  css: `
/* 428 — the seal stamps down */
.pix-428 { transform-origin: 50% 100%; animation: pix-strike 1.6s ease-in infinite; }
.pix-428 .px-r { animation: pix-pulse 1.6s ease-in-out infinite; }
`,
} satisfies ErrorInfo
