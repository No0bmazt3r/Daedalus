import type { ErrorInfo } from '../types'

export default {
  name: 'Precondition Failed', title: 'The omens were wrong',
  myth: 'The priests read the signs and said: not today.',
  block: 'The redstone check came back off.',
  what: 'A condition the request set (like If-Match) was not true on the server.',
  fix: 'Refresh to get the current version, then try again.',
  art: [
    '...mmmmmm...', '..mrrrrrrm..', '..mr....rm..', '..mr....rm..',
    '..mrrrrrrm..', '...mmmmmm...', '.....tt.....', '.....tt.....',
    '....tttt....', '...tttttt...', '..tttttttt..', '............',
  ],
  css: `
/* 412 — the redstone lamp flickers off */
.pix-412 .px-r { animation: pix-glint 1.6s steps(1) infinite; }
`,
} satisfies ErrorInfo
