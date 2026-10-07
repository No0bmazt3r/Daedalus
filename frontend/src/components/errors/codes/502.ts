import type { ErrorInfo } from '../types'

export default {
  name: 'Bad Gateway', title: 'The bridge is out',
  myth: 'The messenger reached the river and found no bridge.',
  block: 'Someone mined out the middle of the bridge.',
  what: 'A server in between got a bad answer from the one behind it.',
  fix: 'Usually a backend that crashed or restarted. Wait a moment and retry.',
  art: [
    '............', '............', '............', 'tttt....tttt',
    'tmmt....tmmt', 't..t....t..t', 't..t.d..t..t', 't..t....t..t',
    't..t..d.t..t', '............', 'aaaaaaaaaaaa', '.aa.aa.aa.aa',
  ],
  css: `
/* 502 — the river flows; rubble keeps falling out of the gap */
.pix-502 .px-a { animation: pix-flow 1.8s ease-in-out infinite; animation-delay: calc(var(--x) * -0.15s); }
.pix-502 .px-d { animation: pix-fall 2.2s ease-in infinite; animation-delay: calc(var(--y) * -0.5s); }
`,
} satisfies ErrorInfo
