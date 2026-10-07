import type { ErrorInfo } from '../types'

export default {
  name: 'Variant Also Negotiates', title: 'A maze inside the maze',
  myth: 'Daedalus built a labyrinth that led back into itself.',
  block: 'The portal opens onto another portal.',
  what: "The server's own content negotiation is misconfigured and loops.",
  fix: 'A server setup bug. There is nothing to do on your side.',
  art: Array.from({ length: 12 }, (_, i) =>
    Array.from({ length: 12 }, (_, j) => {
      const ring = Math.min(i, j, 11 - i, 11 - j)
      return ring % 2 ? '.' : ring % 4 === 0 ? 't' : 'a'
    }).join(''),
  ),
  css: `
/* 506 — the rings pulse inward, a maze inside a maze */
.pix-506 .px-t, .pix-506 .px-a {
  animation: pix-pulse 1.8s ease-in-out infinite;
  animation-delay: calc(min(var(--x), var(--y), 11 - var(--x), 11 - var(--y)) * 0.2s);
}
`,
} satisfies ErrorInfo
