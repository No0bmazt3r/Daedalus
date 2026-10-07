import type { ErrorInfo } from '../types'

export default {
  name: 'Not Found', title: 'Lost in the labyrinth',
  myth: 'Even Daedalus took a wrong turn in here once.',
  block: 'You dug down and found nothing but stone.',
  what: 'This page or resource does not exist, or it has moved.',
  fix: 'Check the address, or head back to the chat.',
  art: [
    'tttttttttttt', 't....t.....t', 't.tt.t.ttt.t', 't.t..t...t.t',
    't.t.ttt.t..t', 't.t...t.t.tt', 't.ttt.t.t..t', 't...t...tt.t',
    'ttt.ttttt..t', 't.....a....t', 't.ttttttt.tt', 'tttttttttttt',
  ],
  css: `
/* 404 — you wander the corridor, looking for the way out */
.pix-404 .px-a { animation: pix-wander 7s infinite; }
.pix-404 .px-a { animation-timing-function: steps(5, end); }
`,
} satisfies ErrorInfo
