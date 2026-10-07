import type { ErrorInfo } from '../types'

export default {
  name: 'Unsupported Media Type', title: 'Unknown material',
  myth: 'Daedalus could not work a metal he had never seen.',
  block: 'This block has no texture. Nobody knows what it is.',
  what: 'The server does not accept this content type.',
  fix: 'Send a supported format (for documents: text, Markdown or PDF).',
  art: [
    'mmmmmmmmmmmm', 'm..........m', 'm...aaaa...m', 'm..aa..aa..m',
    'm......aa..m', 'm.....aa...m', 'm....aa....m', 'm....aa....m',
    'm..........m', 'm....aa....m', 'm..........m', 'mmmmmmmmmmmm',
  ],
  css: `
/* 415 — a dropped item: spins and bobs */
.pix-415 { animation: pix-item 3.6s linear infinite; }
.pix-415 .px-a { animation: pix-pulse 1.2s ease-in-out infinite; }
`,
} satisfies ErrorInfo
