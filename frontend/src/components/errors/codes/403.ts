import type { ErrorInfo } from '../types'

export default {
  name: 'Forbidden', title: 'King Minos says no',
  myth: 'You were seen, and the king still closed the door.',
  block: 'Bedrock. No pickaxe gets through this.',
  what: 'The server knows who you are, but you are not allowed here.',
  fix: 'Ask for access, or go back to somewhere you can reach.',
  art: Array.from({ length: 12 }, (_, i) =>
    Array.from({ length: 12 }, (_, j) =>
      Math.abs(j - i) <= 1 || Math.abs(j - (11 - i)) <= 1 ? 'r' : (i >> 1) % 2 === (j >> 1) % 2 ? 'm' : 't',
    ).join(''),
  ),
  css: `
/* 403 — the red X pulses; the wall shrugs off a knock */
.pix-403 { animation: pix-rattle 4s ease-in-out infinite 1s; }
.pix-403 .px-r { animation: pix-pulse 1.4s ease-in-out infinite; }
`,
} satisfies ErrorInfo
