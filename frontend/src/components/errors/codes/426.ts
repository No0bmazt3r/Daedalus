import type { ErrorInfo } from '../types'

export default {
  name: 'Upgrade Required', title: 'Better tools needed',
  myth: 'Bronze will not cut this. Daedalus needs iron.',
  block: 'This ore needs a better pickaxe.',
  what: 'The server wants the connection upgraded to a different protocol.',
  fix: 'Use the newer protocol the server asks for (see its Upgrade header).',
  art: [
    'mmmmmmmmmmmm', 'mmammmmmmmmm', 'mmmmmmmammmm', 'mammmmmmmmmm',
    'mmmmmammmmmm', 'mmmmmmmmmmam', 'mmmammmmmmmm', 'mmmmmmmmammm',
    'mmmmammmmmmm', 'mammmmmmmmmm', 'mmmmmmmmammm', 'mmmmmmmmmmmm',
  ],
  css: `
/* 426 — the ore sparkles */
.pix-426 .px-a { animation: pix-glint 2.2s steps(1) infinite; animation-delay: calc((var(--x) * 3 + var(--y) * 7) * -0.1s); }
`,
} satisfies ErrorInfo
