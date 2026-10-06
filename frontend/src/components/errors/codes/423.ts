import type { ErrorInfo } from '../types'

export default {
  name: 'Locked', title: 'Sealed shut',
  myth: 'Daedalus sealed this door himself, and he is still inside.',
  block: 'Someone else has this chest open.',
  what: 'The resource is locked, often because something else is using it.',
  fix: 'Wait for the other action to finish, then try again.',
  art: [
    '....tttt....', '...t....t...', '...t....t...', '...t....t...',
    '..wwwwwwww..', '..wwwwwwww..', '..wwwttwww..', '..wwwttwww..',
    '..wwwwwwww..', '..wwwwwwww..', '............', '............',
  ],
  css: `
/* 423 — the padlock is tugged and holds */
.pix-423 { animation: pix-rattle 2.2s ease-in-out infinite; }
`,
} satisfies ErrorInfo
