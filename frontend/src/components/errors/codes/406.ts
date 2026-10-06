import type { ErrorInfo } from '../types'

export default {
  name: 'Not Acceptable', title: "Not to the king's taste",
  myth: 'Minos sent the gift back. It was not what he asked for.',
  block: 'The furnace will not smelt that.',
  what: 'The server cannot send back the format the request asked for.',
  fix: 'Ask for a format the endpoint supports, usually JSON.',
  art: [
    'mmmmmmmmmmmm', 'mttttttttttm', 'mt........tm', 'mt.mmmmmm.tm',
    'mt.m....m.tm', 'mt.m....m.tm', 'mt.mmmmmm.tm', 'mt........tm',
    'mt.rrrrrr.tm', 'mt.rwwwwr.tm', 'mttttttttttm', 'mmmmmmmmmmmm',
  ],
  css: `
/* 406 — the furnace fire flickers */
.pix-406 .px-r, .pix-406 .px-w { animation: pix-flicker 0.6s steps(2) infinite; animation-delay: calc(var(--x) * -0.13s); }
`,
} satisfies ErrorInfo
