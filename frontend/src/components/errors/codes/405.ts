import type { ErrorInfo } from '../types'

export default {
  name: 'Method Not Allowed', title: 'Wrong tool for this block',
  myth: 'Daedalus never carved marble with a feather.',
  block: 'A wooden pickaxe will not mine obsidian.',
  what: 'This address exists, but not for this kind of request (e.g. GET on a POST-only route).',
  fix: 'Use the request method the endpoint expects.',
  art: [
    '..mmmmmmmm..', '.mm......mm.', 'mm...tt...mm', 'm....tt....m',
    '.....tt.....', '.....tt.....', '.....tt.....', '.....tt.....',
    '.....tt.....', '.....tt.....', '.....tt.....', '............',
  ],
  css: `
/* 405 — the pickaxe swings and bounces off */
.pix-405 { transform-origin: 50% 90%; animation: pix-swing 1.5s cubic-bezier(.5, 0, .3, 1) infinite; }
`,
} satisfies ErrorInfo
