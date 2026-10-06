import type { ErrorInfo } from '../types'

export default {
  name: 'Unauthorized', title: 'The gate asks your name',
  myth: 'The labyrinth gate stays shut to strangers.',
  block: 'This iron door needs a key you are not holding.',
  what: 'You are not signed in, or your sign-in has expired.',
  fix: 'Sign in again, then retry.',
  art: [
    '..mmmmmmmm..', '..mttttttm..', '..mt....tm..', '..mt....tm..',
    '..mt....tm..', '..mttttttm..', '..mt.ww.tm..', '..mt.ww.tm..',
    '..mt.ww.tm..', '..mt....tm..', '..mttttttm..', '..mmmmmmmm..',
  ],
  css: `
/* 401 — someone tries the handle; the keyhole glints */
.pix-401 { animation: pix-rattle 3.2s ease-in-out infinite; }
.pix-401 .px-w { animation: pix-glint 3.2s steps(1) infinite; }
`,
} satisfies ErrorInfo
