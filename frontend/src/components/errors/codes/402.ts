import type { ErrorInfo } from '../types'

export default {
  name: 'Payment Required', title: 'The ferryman wants a coin',
  myth: 'Charon will not row anyone across without his coin.',
  block: 'The villager wants an emerald for this trade.',
  what: 'This needs payment before it can go ahead.',
  fix: 'Nothing in Daedalus is paid, so check the address or the service you called.',
  // Steve (o hair, S skin, b shirt, c trousers), empty-handed, facing a Minecraft villager (V skin,
  // K unibrow, W/G eyes, N long nose, o robe, S crossed arms) whose speech bubble (t) asks for an
  // emerald (g).
  art: [
    '.....tttttttt...',
    '....t...gg...t..',
    '....t..gggg..t..',
    '....t...gg...t..',
    '.....tttttttt...',
    '...........t....',
    'ooooo.....VVVVVV',
    'oSSSo.....VKKKKV',
    'SbSbS.....WGVVGW',
    'SSoSS.....VVNNVV',
    'bbbbb.....VVNNVV',
    'SbbbS.....ooNNoo',
    'SbbbS.....oSSSSo',
    '.bbb......oooooo',
    'cc.cc.....oooooo',
    'cc.cc.....oooooo',
  ],
  css: `
/* 402 — the emerald bobs in the villager's bubble; the villager shakes its head: no emerald, no trade */
.pix-402 .px-g { animation: pix-wiggle 1.6s ease-in-out infinite; }
.pix-402 .px-V, .pix-402 .px-K, .pix-402 .px-W, .pix-402 .px-G, .pix-402 .px-N { animation: pix-nope 3s linear infinite; }
`,
} satisfies ErrorInfo
