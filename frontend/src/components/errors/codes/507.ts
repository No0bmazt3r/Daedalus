import type { ErrorInfo } from '../types'

export default {
  name: 'Insufficient Storage', title: 'The storeroom is full',
  myth: 'The workshop has no room left for a single feather.',
  block: 'Every chest is full. Nothing else fits.',
  what: 'The server ran out of disk space, often while pulling a large model.',
  fix: 'Free some space (delete unused models in The Forge), then try again.',
  art: [
    '......bb.....', '......bb.....', '.............', 'ttttttttttttt',
    'taatwwtrrtaat', 'taatwwtrrtaat', 'ttttttttttttt', 'twwtaatwwtrrt',
    'twwtaatwwtrrt', 'ttttttttttttt', 'trrtwwtaatwwt', 'trrtwwtaatwwt',
    'ttttttttttttt',
  ],
  css: `
/* 507 — one more item tries to drop in and bounces off the full chest */
.pix-507 .px-b { animation: pix-reject 1.6s cubic-bezier(.4, 0, .6, 1) infinite; }
.pix-507 { animation: pix-rattle 1.6s ease-in-out infinite; }
`,
} satisfies ErrorInfo
