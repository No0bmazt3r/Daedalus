import type { ErrorInfo } from '../types'

export default {
  name: "I'm a Teapot", title: "The workshop's teapot",
  myth: 'Daedalus built many wonders. This one only makes tea.',
  block: 'You tried to brew coffee in a cauldron.',
  what: 'The server refuses to brew coffee because it is, permanently, a teapot. A joke code (RFC 2324).',
  fix: 'Nothing to fix. Have some tea.',
  art: [
    '....m..m....', '...m..m.....', '....m..m....', '.....tt.....',
    '...tttttt..t', 'tttttttttttt', 't.tttttttt..', 't.twwwwwwt..',
    'tttttttttt..', '..tttttttt..', '...tttttt...', '............',
  ],
  css: `
/* 418 — steam rises from the teapot */
.pix-418 .px-m { animation: pix-rise 2s ease-out infinite; animation-delay: calc(var(--y) * -0.5s + var(--x) * -0.2s); }
`,
} satisfies ErrorInfo
