import type { ErrorInfo } from '../types'

export default {
  name: 'Gone', title: 'Only feathers on the water',
  myth: 'Where Icarus fell, only feathers were left floating.',
  block: 'The block was broken. Not even the item drop is left.',
  what: 'This existed once, but it has been deleted on purpose and is not coming back.',
  fix: 'Head back to the chat; old links to deleted chats or documents end here.',
  art: [
    '......t.....', '.....tt.....', '....tmt.....', '....tmt.....',
    '...tmt......', '...tt.......', '..t.........', '............',
    '............', 'aaaaaaaaaaaa', '.aa.aa.aa.aa', '............',
  ],
  css: `
/* 410 — a feather drifts down onto the water and is gone */
.pix-410 .px-t, .pix-410 .px-m { animation: pix-drift 4s ease-in-out infinite; }
.pix-410 .px-a { animation: pix-flow 2s ease-in-out infinite; animation-delay: calc(var(--x) * -0.15s); }
`,
} satisfies ErrorInfo
