import type { ErrorInfo } from '../types'

export default {
  name: 'Unavailable For Legal Reasons', title: 'By order of the king',
  myth: 'King Minos has forbidden it by royal decree.',
  block: 'The server rules say no.',
  what: 'This cannot be shown for legal reasons.',
  fix: 'Nothing to retry. This is a legal block, not a fault.',
  art: [
    '.mmmmmmmmmm.', 'mttttttttttm', '.t........t.', '.t.mmmmmm.t.',
    '.t........t.', '.t.mmmmm..t.', '.t........t.', '.t.mmmm.rr..',
    '.t.....rrrr.', '.t......rr..', 'mttttttttttm', '.mmmmmmmmmm.',
  ],
  css: `
/* 451 — the royal seal pulses */
.pix-451 .px-r { animation: pix-pulse 1.8s ease-in-out infinite; }
.pix-451 { animation: pix-wiggle-big 4s ease-in-out infinite; }
`,
} satisfies ErrorInfo
