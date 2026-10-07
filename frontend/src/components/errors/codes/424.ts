import type { ErrorInfo } from '../types'

export default {
  name: 'Failed Dependency', title: 'One stone gave way',
  myth: 'Pull out one stone, and the whole wall comes down.',
  block: 'The block underneath was sand.',
  what: 'This failed because a step it depended on failed first.',
  fix: 'Fix the first failure, then retry this one.',
  art: [
    '....mmmm....', '....mmmm....', '....mmmm....', '...tttttt...',
    '...tttttt...', '...tttttt...', '..aaaaaaaa..', '..aaaaaaaa..',
    '..aaaaaaaa..', '...rrrrrr...', '...rrrrrr...', '............',
  ],
  css: `
/* 424 — the sand drops out and the stack above shudders */
.pix-424 { animation: pix-rattle 2.2s ease-in-out infinite; }
.pix-424 .px-r { animation: pix-fall 2.2s ease-in infinite; animation-delay: calc(var(--x) * -0.15s); }
`,
} satisfies ErrorInfo
