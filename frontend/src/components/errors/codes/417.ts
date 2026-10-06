import type { ErrorInfo } from '../types'

export default {
  name: 'Expectation Failed', title: 'The prophecy did not come true',
  myth: 'The oracle promised one thing. The server did another.',
  block: 'The recipe book says this works. The table disagrees.',
  what: "The server cannot meet what the request's Expect header asked for.",
  fix: 'Send the request without the Expect header.',
  art: [
    '............', '............', '....tttt....', '..tt....tt..',
    '.t..aaaa..t.', 't..aa..aa..t', 't..aa..aa..t', '.t..aaaa..t.',
    '..tt....tt..', '....tttt....', '............', '............',
  ],
  css: `
/* 417 — the oracle's eye blinks */
.pix-417 { animation: pix-blink 3.4s ease-in-out infinite; }
.pix-417 .px-a { animation: pix-pulse 1.7s ease-in-out infinite; }
`,
} satisfies ErrorInfo
