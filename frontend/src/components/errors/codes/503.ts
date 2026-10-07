import type { ErrorInfo } from '../types'

export default {
  name: 'Service Unavailable', title: 'Workshop closed for repairs',
  myth: 'Daedalus has stepped out. The doors are barred.',
  block: 'The server is still loading chunks.',
  what: 'The server is down, starting up, or overloaded.',
  fix: 'Make sure the backend is running (./daedalus.sh dev), then retry.',
  art: [
    '..w....w....', '...w..w.....', 'tttttttttt..', '.tttttttttt.',
    '..tttttttt..', '....tttt....', '....tttt....', '...tttttt...',
    '..tttttttt..', '..tttttttt..', '............', '............',
  ],
  css: `
/* 503 — the hammer comes down on the anvil, and it sparks */
.pix-503 { transform-origin: 50% 100%; animation: pix-strike 1.3s ease-in infinite; }
.pix-503 .px-w { animation: pix-spark 1.3s ease-out infinite; }
`,
} satisfies ErrorInfo
