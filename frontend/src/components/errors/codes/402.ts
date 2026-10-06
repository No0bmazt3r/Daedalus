import type { ErrorInfo } from '../types'

export default {
  name: 'Payment Required', title: 'The ferryman wants a coin',
  myth: 'Charon will not row anyone across without his coin.',
  block: 'The villager wants emeralds for this trade.',
  what: 'This needs payment before it can go ahead.',
  fix: 'Nothing in Daedalus is paid, so check the address or the service you called.',
  art: [
    '....wwww....', '..ww....ww..', '.w..wwww..w.', '.w.w....w.w.',
    'w.w..tt..w.w', 'w.w.t..t.w.w', 'w.w.t..t.w.w', 'w.w..tt..w.w',
    '.w.w....w.w.', '.w..wwww..w.', '..ww....ww..', '....wwww....',
  ],
  css: `
/* 402 — the coin spins like a dropped item */
.pix-402 { animation: pix-item 2.4s linear infinite; }
`,
} satisfies ErrorInfo
