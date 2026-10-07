import type { ErrorInfo } from '../types'

export default {
  name: 'Payload Too Large', title: 'Too heavy to fly',
  myth: 'Icarus could not take off carrying the whole workshop.',
  block: 'Your inventory is full.',
  what: 'What was sent is bigger than the server accepts.',
  fix: 'Send something smaller, or split it into parts.',
  art: [
    '............', 'mm........mm', 'mmm......mmm', '.wwwwwwwwww.',
    '.wttttttttw.', '.wttttttttw.', '.wwwwaawwww.', '.wttwaawttw.',
    '.wttttttttw.', '.wttttttttw.', '.wwwwwwwwww.', '............',
  ],
  css: `
/* 413 — the wings flap hard, the chest barely lifts and drops back */
.pix-413 { animation: pix-heavy 2.4s ease-in-out infinite; }
.pix-413 .px-m { transform-origin: 50% 100%; animation: pix-flap 0.3s ease-in-out infinite alternate; }
`,
} satisfies ErrorInfo
