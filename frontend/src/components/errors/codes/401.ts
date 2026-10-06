import type { ErrorInfo } from '../types'

export default {
  name: 'Unauthorized', title: 'The gate asks your name',
  myth: 'The labyrinth gate stays shut to strangers.',
  block: 'An iron door will not open by hand. It needs the button.',
  what: 'You are not signed in, or your sign-in has expired.',
  fix: 'Sign in again, then retry.',
  // A Minecraft iron door (t, windows c, bands m) set in a stone wall (k), a stone button (w) beside
  // it, and Steve's arm (S hand, b sleeve) reaching in from the corner.
  art: [
    '.kkkkkkkkkkk....',
    '.kktttttttkk....',
    '.kktcctcctkk....',
    '.kktcctcctkk....',
    '.kktcctcctkk....',
    '.kktttttttkk....',
    '.kktmmmmmtkk....',
    '.kktttttttkk....',
    '.kktttttmmkkww..',
    '.kktttttttkk....',
    '.kktmmmmmtkk....',
    '.kktttttttkSS...',
    '.kktmtttmtkkSS..',
    '.kktttttttkk.bb.',
    '.kkmmmmmmmkk..bb',
    'kkkkkkkkkkkkk..b',
  ],
  css: `
/* 401 — Steve clicks the iron door twice and nothing happens (iron doors ignore hands);
   then the button beside it glints: that is the way in */
.pix-401 .px-S, .pix-401 .px-b { animation: pix-poke 3.2s ease-out infinite; }
.pix-401 .px-w { animation: pix-glint 3.2s steps(1) infinite; }
`,
} satisfies ErrorInfo
