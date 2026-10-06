import type { ErrorInfo } from '../types'

export default {
  name: 'Not Extended', title: 'A page of the plans is missing',
  myth: "One page of Daedalus's plans was never found.",
  block: 'This item needs an add-on that is not installed.',
  what: 'The request needs an extension the server does not have. An obsolete code.',
  fix: 'Rarely seen today. Check the client that sent it.',
  art: Array.from({ length: 12 }, (_, i) =>
    Array.from({ length: 12 }, (_, j) => {
      const missing = Math.floor(i / 4) === 1 && Math.floor(j / 4) === 2
      if (i % 4 === 3 || j % 4 === 3) return '.'
      return missing ? ((i + j) % 2 ? 'd' : '.') : 'a'
    }).join(''),
  ),
  css: `
/* 510 — the missing piece flickers */
.pix-510 .px-d { animation: pix-glint 1.2s steps(1) infinite; }
`,
} satisfies ErrorInfo
