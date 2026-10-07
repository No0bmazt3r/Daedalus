import type { ErrorInfo } from '../types'

export default {
  name: 'Too Many Requests', title: 'Flying too close to the sun',
  myth: 'Icarus climbed too fast, and the wax gave way.',
  block: 'Slow down. The furnace is still smelting the last batch.',
  what: 'Too many requests in a short time, so the server is rate limiting you.',
  fix: 'Wait a moment, then try again more slowly.',
  art: [
    '.....ww.....', '.w...ww...w.', '..w......w..', '....wwww....',
    '...wwwwww...', 'ww.wwwwww.ww', 'ww.wwwwww.ww', '...wwwwww...',
    '....wwww....', '..w......w..', '.w...ww...w.', '.....ww.....',
  ],
  css: `
/* 429 — the sun turns slowly and its rays flare */
.pix-429 { animation: pix-spin 24s linear infinite; }
.pix-429 .px-w { animation: pix-pulse 1.6s ease-in-out infinite; animation-delay: calc(var(--x) * 0.1s); }
`,
} satisfies ErrorInfo
