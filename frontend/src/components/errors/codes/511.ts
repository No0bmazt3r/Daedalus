import type { ErrorInfo } from '../types'

export default {
  name: 'Network Authentication Required', title: 'The gatekeeper wants a toll',
  myth: 'Before the bridge, the toll-keeper wants your name.',
  block: 'Sign the guestbook before you enter this world.',
  what: 'The network you are on (hotel, campus Wi-Fi) wants you to log in before anything gets through.',
  fix: "Open any website to get the network's login page, sign in, then come back.",
  art: [
    '............', '..aaaaaaaa..', '.a........a.', 'a..aaaaaa..a',
    '..a......a..', '....aaaa....', '...a....a...', '.....tt.....',
    '....wwww....', '....wwww....', '....wwww....', '............',
  ],
  css: `
/* 511 — the signal arcs light up, but the lock stays */
.pix-511 .px-a { animation: pix-pulse 1.8s ease-in-out infinite; animation-delay: calc(var(--y) * 0.18s); }
.pix-511 .px-w { animation: pix-rattle 2.6s ease-in-out infinite; }
`,
} satisfies ErrorInfo
