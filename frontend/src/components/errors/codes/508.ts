import type { ErrorInfo } from '../types'

export default {
  name: 'Loop Detected', title: 'Running in circles',
  myth: 'Theseus walked the same corridor again, and again, and again.',
  block: 'A redstone clock with no off switch.',
  what: 'The server found an endless loop while handling the request.',
  fix: 'A server-side bug. Report it rather than retrying.',
  art: [
    '....aaaa....', '..aa....aa..', '.a........a.', '.a........w.',
    'a..........a', 'a..........a', 'a..........a', 'a..........a',
    '.a........a.', '.a........a.', '..aa....aa..', '....aaaa....',
  ],
  css: `
/* 508 — round and round */
.pix-508 { animation: pix-spin 3s linear infinite; }
`,
} satisfies ErrorInfo
