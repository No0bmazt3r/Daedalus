import type { ErrorInfo } from '../types'

export default {
  name: 'Range Not Satisfiable', title: 'Past the edge of the map',
  myth: 'You asked for the part of the maze beyond its outer walls.',
  block: 'You walked past the world border.',
  what: 'The part of the file asked for (a byte range) is outside what exists.',
  fix: 'Ask for the whole thing, or a range inside its size.',
  art: [
    'tttttttt....', 't......t....', 't.mm...t....', 't.mm...t....',
    't......t....', 't....m.t..r.', 't......t.rr.', 't..m...t..r.',
    't......t....', 't...mm.t....', 't......t....', 'tttttttt....',
  ],
  css: `
/* 416 — the dot outside the map keeps drifting further off */
.pix-416 .px-r { animation: pix-drift 3s ease-in-out infinite; }
`,
} satisfies ErrorInfo
