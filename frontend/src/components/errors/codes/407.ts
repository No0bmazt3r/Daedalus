import type { ErrorInfo } from '../types'

export default {
  name: 'Proxy Authentication Required', title: 'A second gate, a second guard',
  myth: 'Past the first gate of the labyrinth stands another guard.',
  block: 'The outer wall has its own door, and its own key.',
  what: 'A proxy between you and the server wants you to sign in to it first.',
  fix: "Sign in to your network's proxy, or connect without it.",
  art: [
    'mmmmm..mmmmm', 'mtttm..mtttm', 'mt.tm..mt.tm', 'mt.tm..mt.tm',
    'mtttm..mtttm', 'mt.tm..mt.tm', 'mtwtm..mtwtm', 'mt.tm..mt.tm',
    'mtttm..mtttm', 'mt.tm..mt.tm', 'mtttm..mtttm', 'mmmmm..mmmmm',
  ],
  css: `
/* 407 — both doors rattle in turn, both keyholes glint */
.pix-407 { animation: pix-rattle 2.6s ease-in-out infinite; }
.pix-407 .px-w { animation: pix-glint 2.6s steps(1) infinite; animation-delay: calc(var(--x) * -0.1s); }
`,
} satisfies ErrorInfo
