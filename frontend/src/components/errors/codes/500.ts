import type { ErrorInfo } from '../types'

export default {
  name: 'Internal Server Error', title: 'The workshop caught fire',
  myth: 'Something in the forge went badly wrong.',
  block: 'A block update cascaded and took the build with it.',
  what: 'The server hit an unexpected error. This is a bug, not something you did.',
  fix: 'Try again. If it keeps happening, check Settings → Process Log.',
  art: [
    '.....r......', '....rr......', '....rrr..r..', '...rrwr..rr.',
    '..rrwwrrrrr.', '..rwwwwrwrr.', '.rrwwawwwrr.', '.rwwaaawwwr.',
    '.rwaaaaawwr.', '.rwaaaaaawr.', '..rwaaaawr..', '...rrrrrr...',
  ],
  css: `
/* 500 — the fire flickers, every pixel on its own beat */
.pix-500 { transform-origin: 50% 100%; animation: pix-blaze 0.9s ease-in-out infinite alternate; }
.pix-500 .px-r, .pix-500 .px-w, .pix-500 .px-a {
  animation: pix-flicker 0.7s steps(2) infinite;
  animation-delay: calc(var(--x) * -0.17s + var(--y) * -0.11s);
}
`,
} satisfies ErrorInfo
