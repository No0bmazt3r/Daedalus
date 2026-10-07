import type { ErrorInfo } from '../types'

export default {
  name: 'Not Implemented', title: 'Still on the drawing board',
  myth: 'Daedalus has drawn this one, but not built it yet.',
  block: 'The scaffolding is up. The blocks are not.',
  what: 'The server does not support this feature yet.',
  fix: 'It is planned but not built. See docs/MODULES.md for what is next.',
  art: [
    'mmmmmmmmmmmm', 'm....m.....m', 'm....m.....m', 'mmmmmmmmmmmm',
    'm....m.....m', 'maaaamaaaaam', 'mmmmmmmmmmmm', 'maaaamaaaaam',
    'maaaamaaaaam', 'mmmmmmmmmmmm', 'maaaamaaaaam', 'mmmmmmmmmmmm',
  ],
  css: `
/* 501 — the blocks go up row by row, then the build starts over */
.pix-501 .px-a { animation: pix-build 4s steps(1) infinite; animation-delay: calc((11 - var(--y)) * 0.35s); }
`,
} satisfies ErrorInfo
