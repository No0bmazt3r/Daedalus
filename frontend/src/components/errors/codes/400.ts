import type { ErrorInfo } from '../types'

export default {
  name: 'Bad Request', title: 'The circuit is miswired',
  myth: "Even Daedalus's machines sat still when one part was set wrong.",
  block: 'One dust out of place, and the piston never moves.',
  what: 'The request was malformed, so the server could not read it.',
  fix: 'Check what was sent, fix the input, and try again.',
  // Minecraft in a 3/4 view: each block is 7 wide, its top face 4 tall (light) and its front face
  // below it (c, dark). A lever (k plate, o pivot, stick standing up: h on / j off) feeds redstone
  // dust (x) that splits. The top line is wired right: its piston (k body, e/i wood head) pushes its
  // arm (f/F) and head (P/Q) out one block. The bottom line runs through a repeater (m slab, o/y
  // torches) into dust (z), then one dust is missing, so the dust past it (q) never powers and its
  // piston never moves. p/u are the red sparks powered dust gives off (none on the dead dust).
  art: [
    '........................................................',
    '..........................................kkkkkee.....PP',
    '.............p..........p...........p...p.kkkkkeefffffPP',
    '...j...h..xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxkkkkkeeFFFFFPP',
    '....j.h...x.......p...........p...........kkkkkee.....PP',
    '.....o...px...............................cccccii.....QQ',
    '....kkk.p.x...............................cccccii.....QQ',
    '....kkkxxxx...............................cccccii.....QQ',
    '....ccc...xp...y...y......................cccccii.....QQ',
    '..........x...mommmom.....................kkkkkee.......',
    '.........px...mommmom.u....u..............kkkkkee.......',
    '..........xxxxmmmmmmmzzzzzzz.......qqqqqqqkkkkkee.......',
    '............p.mmmmmmm....u................kkkkkee.......',
    '..............ccccccc.....................cccccii.......',
    '..............ccccccc.....................cccccii.......',
    '..........................................cccccii.......',
    '..........................................cccccii.......',
  ],
  css: `
/* 400 — the lever flips on: the dust powers instantly and the top piston pushes out; the repeater
   passes power on a tick later, then the missing dust stops it and the bottom piston stays put.
   Lever off, piston back, repeat. */
.pix-400 .px-h { animation: pix-on 4s steps(1) infinite; }
.pix-400 .px-j { animation: pix-on 4s steps(1) infinite; animation-delay: -2s; }
.pix-400 .px-x { animation: pix-power 4s steps(1) infinite; }
.pix-400 .px-y, .pix-400 .px-z { animation: pix-power 4s steps(1) infinite; animation-delay: 0.3s; }
.pix-400 .px-f, .pix-400 .px-F, .pix-400 .px-P, .pix-400 .px-Q { animation: pix-on 4s steps(1) infinite; }
/* Sparks: shown only while their dust is powered (opacity), each popping and drifting up (transform) */
.pix-400 .px-p, .pix-400 .px-u {
  animation: pix-on 4s steps(1) infinite, pix-twinkle 0.9s linear infinite;
  animation-delay: 0s, calc((var(--x) * 7 + var(--y) * 3) * -0.07s);
}
.pix-400 .px-u { animation-delay: 0.3s, calc((var(--x) * 7 + var(--y) * 3) * -0.07s); }
/* Still picture: lever off, piston in, no sparks */
@media (prefers-reduced-motion: reduce) {
  .pix-400 .px-p, .pix-400 .px-u,
  .pix-400 .px-h, .pix-400 .px-f, .pix-400 .px-F, .pix-400 .px-P, .pix-400 .px-Q { opacity: 0; }
}
`,
} satisfies ErrorInfo
