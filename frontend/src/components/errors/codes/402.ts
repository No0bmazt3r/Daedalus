import type { ErrorInfo } from '../types'

export default {
  name: 'Payment Required', title: 'The ferryman wants an emerald',
  myth: 'Charon will not row anyone across without his coin.',
  block: 'One emerald for the ride. No emerald, no crossing.',
  what: 'This needs payment before it can go ahead, and none was given.',
  fix: 'Nothing in Daedalus is paid, so check the address or the service you called.',
  // A Minecraft ferry, front on as in the game's renders, tops and sides of things showing (3D).
  // Steve stands on a wooden dock (H plank tops, J fronts, M seams, c shadow); the villager waits in
  // an oak boat (H rim and oar, J hull, M plank seam) on the sea (L water, w crests, l glints),
  // reaching an open palm to Steve (R sleeve, j hand) under the outline of the emerald it wants (e).
  // Its bubble (U) asks "emerald?" (g); Steve's bubble (T) answers with an emerald crossed out
  // (E, X): he has none.
  art: [
    '...TTTTTTTTT....................................',
    '..T..X.E.X..T...................................',
    '..T...XEX...T...................................',
    '..T..EEXEE..T...................................',
    '..T...XEX...T.............UUUUUUUUUUU...........',
    '..T..X.E.X..T............U...g...UUU.U..........',
    '...TTTTTTTTT.............U..ggg....U.U..........',
    '.......T.................U.ggggg..UU.U..........',
    '........T................U..ggg......U..........',
    '....OOOOOOOO.............U...g....U..U..........',
    '....ooooooooo.............UUUUUUUUUUU...........',
    '....ooooooooo..................U................',
    '....oSSSSSSos..................U................',
    '....SSSSSSSSs...................................',
    '....StPSSPtSs...............vvvvvvvv............',
    '....SSSnnSSSs...............VVVVVVVVu...........',
    '....SSqqqqSSs...............VVVVVVVVu...........',
    '....SqSSSSqSs...............VVVVVVVVu...........',
    'sbbbbbbbbbbdbbbd............VVVVVVVVu...........',
    'sbbbbbbbbbbdbbbd............VKKKKKKVu...........',
    'sbbbbbbbbbbdbbbd............VKGNNGKVu...........',
    'sbbbbbbbbbbdbbbd...e........VVVNNVVVu...........',
    'sSSSbbbbbbbdSSSs..e.e.......VVVNNVVVu...........',
    'sSSSbbbbbbbdSSSs.e...e......VVVNNVVVu...........',
    'sSSSbbbbbbbdSSSs..e.e.......VVVVVVVVu...........',
    'sSSSbbbbbbbdSSSs...e........YYYNNYYy............',
    'sSSSbbbbbbbdSSSs............YYYYYYYy............',
    'sSSSbbbbbbbdSSSs...j........yyyyyyyyyy..........',
    'sSSSbbbbbbbdSSSs...jjRRRRRRRYYhhhhYYYy..........',
    'sSSSbbbbbbbdSSSs...jjRRRRRRRYYhhhhYYYy..........',
    '....IIIiIIIi.........yyyyyyyyyyyyyyyyy..........',
    '....IIIiIIIi................YYYYYYYy............',
    '....IIIiIIIi................YYYYYYYy............',
    '....IIIiIIIi.......HHHHHHHHHHHHHHHHHHHHHHHHHH...',
    '....IIIiIIIi.......JJJJJJJJJJJJJJJJJJJJJJJJJJH..',
    '....IIIiIIIi........MMMMMMMMMMMMMMMMMMMMMMMM..H.',
    '....mmmmmmmm.........JJJJJJJJJJJJJJJJJJJJJJ...H.',
    '....mmmmmmmm..........JJJJJJJJJJJJJJJJJJJJ.....H',
    'HcccccccccccccccHLwwwLLLwwwLLLwwwLLLwwwLLLwwwLLH',
    'JJJJJMJJJJJMJJJJJLLLLLLLLLLLLLlLLLLLLLLLLLLLLLLL',
    'JJJJJMJJJJJMJJJJJLLLLLlLLLLLLLLLLLLLLLLLLLLLlLLL',
    'JJJJJMJJJJJMJJJJJLLLLLLLLLLLLLLLLLLLLLlLLLLLLLLL',
  ],
  colours: {
    // Steve
    o: 'color-mix(in srgb, var(--status-warn) 30%, var(--bg))', // hair
    O: 'color-mix(in srgb, var(--status-warn) 45%, var(--bg))', // top of his hair
    S: 'color-mix(in srgb, var(--status-warn) 30%, var(--text-main))', // skin
    s: 'color-mix(in srgb, var(--status-warn) 40%, var(--text-muted))', // skin in shade
    n: 'color-mix(in srgb, var(--status-warn) 40%, var(--text-muted))', // nose
    q: 'color-mix(in srgb, var(--status-warn) 40%, var(--bg))', // mouth and beard
    t: 'var(--text-main)', // eye white
    P: 'color-mix(in srgb, var(--status-info) 55%, var(--status-bad))', // eye, purple
    b: 'var(--status-info)', // shirt
    d: 'color-mix(in srgb, var(--status-info) 60%, var(--bg))', // shirt in shade
    I: 'color-mix(in srgb, color-mix(in srgb, var(--status-info) 60%, var(--status-bad)) 70%, var(--bg))', // trousers
    i: 'color-mix(in srgb, color-mix(in srgb, var(--status-info) 60%, var(--status-bad)) 45%, var(--bg))', // trousers in shade
    m: 'var(--text-muted)', // shoes
    // the villager
    v: 'color-mix(in srgb, var(--status-warn) 15%, var(--text-main))', // top of the head
    V: 'color-mix(in srgb, var(--status-bad) 12%, color-mix(in srgb, var(--status-warn) 30%, var(--text-main)))', // skin
    u: 'color-mix(in srgb, var(--status-warn) 40%, var(--text-muted))', // side of the head
    h: 'color-mix(in srgb, var(--status-bad) 12%, color-mix(in srgb, var(--status-warn) 30%, var(--text-main)))', // hands
    K: 'color-mix(in srgb, var(--status-warn) 25%, var(--bg))', // unibrow, eye edge
    G: 'var(--status-ok)', // eyes
    N: 'color-mix(in srgb, var(--status-warn) 45%, var(--text-muted))', // nose
    Y: 'color-mix(in srgb, var(--status-ok) 40%, var(--text-muted))', // robe
    y: 'color-mix(in srgb, var(--status-ok) 30%, var(--bg))', // robe in shade, folded arm
    R: 'color-mix(in srgb, var(--status-ok) 40%, var(--text-muted))', // sleeve of the reaching arm
    j: 'color-mix(in srgb, var(--status-bad) 12%, color-mix(in srgb, var(--status-warn) 30%, var(--text-main)))', // open palm
    e: 'var(--status-ok)', // outline of the emerald it wants
    // the boat and the sea
    H: 'color-mix(in srgb, var(--status-warn) 50%, var(--text-muted))', // boat rim, oar, dock tops
    J: 'color-mix(in srgb, var(--status-warn) 40%, var(--bg))', // hull
    M: 'color-mix(in srgb, var(--status-warn) 20%, var(--bg))', // plank seams
    L: 'color-mix(in srgb, var(--status-info) 40%, var(--bg))', // water
    w: 'color-mix(in srgb, var(--status-info) 65%, var(--text-main))', // wave crest
    l: 'color-mix(in srgb, var(--status-info) 50%, var(--text-main))', // glint
    c: 'color-mix(in srgb, var(--status-warn) 15%, var(--bg))', // Steve's shadow on the dock
    // the bubbles
    T: 'var(--text-main)',
    U: 'var(--text-main)',
    g: 'var(--status-ok)', // emerald
    E: 'color-mix(in srgb, var(--status-ok) 50%, var(--bg))', // emerald, crossed out
    X: 'var(--status-bad)', // the cross
  },
  css: `
/* 402 — the ferryman's fee: the villager rocks in its boat, palm held out under a blinking emerald
   outline, and asks "emerald?"; Steve answers he has none, and the villager shakes its head. */
@keyframes pix-say-a { 0% { opacity: 0; } 5% { opacity: 1; } 45% { opacity: 0; } }
@keyframes pix-say-b { 0% { opacity: 0; } 50% { opacity: 1; } 90% { opacity: 0; } }
@keyframes pix-rock {
  0%, 33.3%, 66.7%, 100% { transform: translateY(0); }
  16.7%, 50%, 83.3% { transform: translateY(-0.5px); }
}
/* the same rocking, with the head shake laid over it */
@keyframes pix-rock-nope {
  0%, 33.3% { transform: translate(0, 0); }
  16.7%, 50% { transform: translate(0, -0.5px); }
  60% { transform: translate(0, -0.2px); }
  63% { transform: translate(-0.5px, -0.1px); }
  66% { transform: translate(0.5px, 0); }
  69% { transform: translate(-0.5px, -0.05px); }
  72% { transform: translate(0.5px, -0.15px); }
  75% { transform: translate(0, -0.25px); }
  83.3% { transform: translate(0, -0.5px); }
  100% { transform: translate(0, 0); }
}
.pix-402 .px-U, .pix-402 .px-g { animation: pix-say-a 6s steps(1) infinite; }
.pix-402 .px-T, .pix-402 .px-E, .pix-402 .px-X { animation: pix-say-b 6s steps(1) infinite; }
.pix-402 .px-H, .pix-402 .px-J, .pix-402 .px-M, .pix-402 .px-Y, .pix-402 .px-y, .pix-402 .px-h,
.pix-402 .px-R, .pix-402 .px-j {
  animation: pix-rock 6s ease-in-out infinite;
}
.pix-402 .px-v, .pix-402 .px-V, .pix-402 .px-u, .pix-402 .px-K, .pix-402 .px-G, .pix-402 .px-N {
  animation: pix-rock-nope 6s ease-in-out infinite;
}
.pix-402 .px-e { animation: pix-rock 6s ease-in-out infinite, pix-pulse 1.2s ease-in-out infinite; }
.pix-402 .px-w { animation: pix-flow 3s ease-in-out infinite; }
.pix-402 .px-l { animation: pix-glint 3s steps(1) infinite; animation-delay: calc(var(--x) * -0.13s); }
`,
} satisfies ErrorInfo
