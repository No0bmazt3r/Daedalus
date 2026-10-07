# Error pages

All 40 standard HTTP error codes have their own full-screen page in Daedalus:
a pixel-art picture drawn in the theme's colours, a themed title, a Daedalus line
and a block-built line, then plain *what happened* / *what to try*, and an
animation of its own.

This file is the reference for tweaking them. The pages themselves live in
`frontend/src/components/errors/`.

## Where things are

```
frontend/src/components/errors/
  codes/<code>.ts   one file per code: text, picture and its animation (css)
  catalogue.ts      finds every file in codes/ by name; nothing to register
  types.ts          the shape a code file follows (ErrorInfo)
  ErrorPage.tsx     the full-screen layout
  PixelArt.tsx      draws a picture; the colour letters (COLOURS)
  animations.css    the shared motions (keyframes) and the reduced-motion rule
```

**Preview:** run `./daedalus.sh dev` and open `/error/404` (or any code). In
development a row of every code sits under the page; click through them. Edits
hot-reload.

**When they show for real:** 404 for an unknown address, 503 while the backend
is down (it lifts on its own), 500 or the error's own code when a page crashes,
and any page at `/error/<code>`. Everyday failures (a 409 on one save) stay as
an inline message where you did the action.

**When one part fails, that part becomes the error page: `TabError`.** A tab,
window or panel that cannot load — a Forge pane, a Blueprints tab, a Settings
panel, Data stores, Ariadne's Thread — is replaced by the same error page,
sized to fill it: the code's picture and animation, title, myth and block lines,
*what happened* / *what to try*, the error's own message, and **Try again**
(not on a 404). Side by side when the space is wide, stacked when it is narrow.
The rest of the app keeps working. The full-screen `ErrorPage` is only for the
app itself failing (an unknown address, the backend down).

```tsx
const [loadError, setLoadError] = useState<LoadFailure | null>(null)
// …fetch().catch((e) => setLoadError(toFailure(e)))
if (loadError) return <TabError code={loadError.status} detail={loadError.message}
                                what="The model table could not be loaded." onRetry={load} />
if (!data) return <Skeleton />   // the error check comes first, or a failure loads forever
```

There is no small error box for a load failure, and no silent fallback — an
empty list or a skeleton that never resolves would hide the failure, and an
empty list also claims something false ("nothing recorded"). A failed *action*
(a save, a pull, a 422 on an input) stays a short line next to the control.

## Tweaking an animation

Each code's animation is the `css` field at the bottom of its file. For example,
`codes/404.ts`:

```ts
  css: `
/* 404 — you wander the corridor, looking for the way out */
.pix-404 .px-a { animation: pix-wander 7s infinite; }
.pix-404 .px-a { animation-timing-function: steps(5, end); }
`,
```

### The two selectors

| Selector | Moves | Example |
|---|---|---|
| `.pix-<code>` | The whole picture | `.pix-508 { animation: pix-spin 3s linear infinite; }` spins the whole loop |
| `.pix-<code> .px-<letter>` | Only the pixels of one colour letter | `.pix-404 .px-a { … }` moves only the dot in the maze |

Inside the picture, **1px is one grid cell**: `translateX(2px)` moves a pixel
two blocks. On `.pix-<code>` (the whole picture), px are normal screen pixels.

### Per-pixel position: `--x` and `--y`

Every pixel carries its column and row as `--x` and `--y` (0 at the top left).
Use them in `animation-delay` to make an effect ripple across the picture:

```css
/* a wave running left to right */
.pix-411 .px-m { animation: pix-pulse 1.8s ease-in-out infinite; animation-delay: calc(var(--x) * 0.15s); }

/* bottom row first, building upwards */
.pix-501 .px-a { animation: pix-build 4s steps(1) infinite; animation-delay: calc((11 - var(--y)) * 0.35s); }

/* rings, from the outside in */
.pix-506 .px-t { animation-delay: calc(min(var(--x), var(--y), 11 - var(--x), 11 - var(--y)) * 0.2s); }
```

A negative delay starts the pixel part-way through, so the ripple is already
running when the page opens.

### Common tweaks

| To | Change |
|---|---|
| Speed it up or slow it down | The duration, e.g. `7s` → `4s` |
| Make a ripple tighter or looser | The multiplier in `calc(var(--x) * 0.13s)` |
| Move a different part | The letter in `.px-<letter>` (see the colour letters below) |
| Move one part on its own | Give those pixels their own letter in `art` (`d` exists for this: muted, but separate) |
| Swap the motion entirely | The keyframe name, e.g. `pix-pulse` → `pix-glint` |
| Change a motion everywhere | Its `@keyframes` in `animations.css` (check the table below for who else uses it) |
| Add a new motion | A new `@keyframes pix-<name>` in `animations.css`, then use it from the code file |
| Turn one page's animation off | Empty its `css` string |

People who ask their system for less motion (`prefers-reduced-motion`) always
get still pictures; that rule is in `animations.css` and wins over every code's
`css`.

### Colour letters

The `art` field is rows of letters, one per pixel, `.` for empty. Pictures are
square, 12 or 13 wide; a wider scene (400 is 56×17, 402 is 48×42) also works: the page goes full width and the picture takes its whole column at its own aspect.

| Letter | Colour | Class |
|---|---|---|
| `a` | Theme primary (accent) | `.px-a` |
| `t` | Main text colour | `.px-t` |
| `m` | Muted text colour | `.px-m` |
| `r` | Bad / red | `.px-r` |
| `w` | Warning / amber | `.px-w` |
| `g` | OK / green | `.px-g` |
| `d` | Muted, a separate letter so it can move on its own (the 502 rubble, the 510 missing piece) | `.px-d` |
| `b` | Info / blue (the 507 item that will not fit) | `.px-b` |
| `k c o h j x z y q p u e i f F P Q` | Minecraft materials for the 400 circuit (cobblestone, block front face, wood, lever on/off, redstone dust, repeater torch, dust sparks, piston head top/front, arm top/front, pushed-out head top/front), mixed from theme colours; unlit dust is `--dust-off` | `.px-<letter>` |

Shared letters go in `COLOURS` in `PixelArt.tsx`. A picture that needs many colours of its own (402) sets a `colours` map in its code file instead; its letters override the shared ones for that picture only.

### Shared motions (`animations.css`)

| Keyframe | What it does | Used by |
|---|---|---|
| `pix-pulse` | Fades to 35% and back | 402 403 411 415 417 421 422 428 429 431 451 504 505 506 511 |
| `pix-glint` | Two quick blinks, then holds | 401 402 407 409 412 422 426 510 |
| `pix-rattle` | Pause, then a short sideways shake | 403 407 423 424 507 511 |
| `pix-wiggle` | Bobs up 0.4 cells and back | 411 |
| `pix-on` | Hidden, shown for the middle half of the cycle (use `steps(1)`) | 400 |
| `pix-poke` | An arm reaches in twice, then rests | 401 |
| `pix-twinkle` | A spark pops up, drifts up and shrinks away (pair with `pix-on` to gate it) | 400 |
| `pix-power` | Redstone dust: dark red, bright red, dark again (use `steps(1)`) | 400 |
| `pix-wiggle-big` | Sways ±1.5° | 451 |
| `pix-flow` | Drifts 0.6 cells sideways and back (water, scrolls) | 402 410 414 502 |
| `pix-fall` | Drops 5 cells and fades out | 424 502 |
| `pix-drift` | Floats down while swaying, fades in and out | 410 416 |
| `pix-item` | 3D spin with a bob, like a dropped item | 415 |
| `pix-spin` | Full turn | 429 508 |
| `pix-flicker` | Uneven opacity, for fire | 406 500 |
| `pix-blaze` | Stretches up slightly, for a flame | 500 |
| `pix-strike` | Rises, slams down with a squash | 428 503 |
| `pix-spark` | Flashes and flies up after the strike | 503 |
| `pix-wander` | Moves left 5 cells, right 9, back (the maze corridor) | 404 |
| `pix-swing` | Swings −22° to 14° with a bounce | 405 |
| `pix-clash` | Pause, then a jolt and wobble | 409 |
| `pix-heavy` | Lifts 12px and drops back | 413 |
| `pix-flap` | Squashes vertically, fast (wings) | 413 |
| `pix-burnout` | Shrinks to nothing, then relights | 408 |
| `pix-build` | Appears, holds, disappears | 501 |
| `pix-reject` | Drops in, bounces, lifts away | 507 |
| `pix-flip` | Holds, turns 180°, holds, turns again | 504 |
| `pix-blink` | Squashes almost flat for a moment (an eye) | 417 |
| `pix-rise` | Floats up 3 cells and fades (steam) | 418 |
| `pix-grow` | Scales up from nothing, holds, fades | 425 |

## Every page

**Likely?** is whether the code can realistically come up in Daedalus.

### 4xx: the request has a problem

| Code | Name | Page title | What the error means | Picture and animation | Likely? |
|---|---|---|---|---|---|
| 400 | Bad Request | The circuit is miswired | The request was malformed, so the server couldn't read it | Minecraft in a 3/4 view (blocks show a top and a front face): one lever feeds two dust lines; the right one fires its piston, the other passes a repeater, hits one missing dust, and its piston never moves | Possible |
| 401 | Unauthorized | The gate asks your name | Not signed in, or the sign-in expired | Steve clicks an iron door twice and nothing happens; the button beside it glints | No (no login) |
| 402 | Payment Required | The ferryman wants an emerald | Payment is needed before it can go ahead | The ferry: Steve on a wooden dock, a villager rocking in an oak boat holds out an open palm under a blinking emerald outline and asks "emerald?"; Steve's bubble shows a crossed-out emerald, the villager shakes its head | No |
| 403 | Forbidden | King Minos says no | The server knows who you are, but you're not allowed | A block wall with a pulsing red X that shakes off a knock | No (no login) |
| 404 | Not Found | Lost in the labyrinth | The page or resource doesn't exist, or has moved | A maze, with you (a dot) wandering the corridor | **Yes** |
| 405 | Method Not Allowed | Wrong tool for this block | The address exists, but not for this kind of request | A pickaxe that swings and bounces off | Only from a coding bug |
| 406 | Not Acceptable | Not to the king's taste | The server can't send back the format that was asked for | A furnace whose fire flickers | Very unlikely |
| 407 | Proxy Authentication Required | A second gate, a second guard | A proxy in between wants you to sign in to it first | Two doors that rattle, keyholes glinting in turn | Only behind a proxy |
| 408 | Request Timeout | The torch burned out | The server gave up waiting for the rest of the request | A torch that burns down to nothing, then catches again | Possible (slow uploads) |
| 409 | Conflict | Two paths, one corridor | Clashes with the current state (duplicate, or changed meanwhile) | Two crossed blades that clash | **Yes** |
| 410 | Gone | Only feathers on the water | It existed once, but was deleted on purpose | A feather drifting onto water and vanishing | Possible |
| 411 | Length Required | How long is the thread? | The server needs the request's size up front | A ruler whose ticks light up one by one, with a spool | No |
| 412 | Precondition Failed | The omens were wrong | A condition the request set wasn't true on the server | A redstone lamp that flickers off | No |
| 413 | Payload Too Large | Too heavy to fly | What was sent is bigger than the server accepts | Wings flapping hard under a chest that barely lifts | **Yes** (big uploads) |
| 414 | URI Too Long | The scroll would not fit | The address is too long for the server to read | A scroll that keeps unrolling | Very unlikely |
| 415 | Unsupported Media Type | Unknown material | The server doesn't accept this content type | A "?" block that spins and bobs | **Yes** (wrong file type) |
| 416 | Range Not Satisfiable | Past the edge of the map | The part of the file asked for is outside what exists | A map with a dot drifting off past its edge | No |
| 417 | Expectation Failed | The prophecy did not come true | The server can't meet the request's Expect header | An eye (the oracle) that blinks | No |
| 418 | I'm a Teapot | The workshop's teapot | A joke code: the server is a teapot | A teapot with rising steam | Easter egg |
| 421 | Misdirected Request | The letter went to the wrong island | Reached a server that can't answer for this address | A portal that swirls | No |
| 422 | Unprocessable Entity | Crafted wrong | Readable, but some values failed validation | A crafting grid lighting up slot by slot, the wrong slot blinking red | **Yes** |
| 423 | Locked | Sealed shut | Locked, often because something else is using it | A padlock that gets tugged and holds | No |
| 424 | Failed Dependency | One stone gave way | Failed because a step it depended on failed first | A block stack whose sand bottom falls out | No |
| 425 | Too Early | The wax is still warm | The server won't risk a request sent this early | A sapling that grows, then starts over | No |
| 426 | Upgrade Required | Better tools needed | The server wants a different protocol | An ore block that sparkles | No |
| 428 | Precondition Required | Show your seal first | The request must carry a condition so changes can't overwrite each other | A seal stamp that comes down | No |
| 429 | Too Many Requests | Flying too close to the sun | Too many requests in a short time | A sun that slowly turns while its rays flare | **Yes** (web search) |
| 431 | Request Header Fields Too Large | Too many seals on the letter | The request's headers, often cookies, are too large | An envelope whose stamps flash in turn | Rare |
| 451 | Unavailable For Legal Reasons | By order of the king | It can't be shown for legal reasons | A swaying decree with a pulsing royal seal | No |

### 5xx: the server has a problem

| Code | Name | Page title | What the error means | Picture and animation | Likely? |
|---|---|---|---|---|---|
| 500 | Internal Server Error | The workshop caught fire | An unexpected server error: a bug, not your fault | A flame, every pixel flickering on its own beat | **Yes** (crashes) |
| 501 | Not Implemented | Still on the drawing board | The feature isn't supported yet | Scaffolding filling with blocks row by row, then starting over | Possible |
| 502 | Bad Gateway | The bridge is out | A server in between got a bad answer from the one behind it | A broken bridge over a flowing river, rubble falling from the gap | Possible |
| 503 | Service Unavailable | Workshop closed for repairs | The server is down, starting up or overloaded | An anvil that gets struck and sparks | **Yes** (shows when the backend is down) |
| 504 | Gateway Timeout | The message never came back | A server waited too long for another to answer | An hourglass whose sand drains, then it flips | **Yes** (slow model loads) |
| 505 | HTTP Version Not Supported | An older tongue | The HTTP version used isn't supported | Two version blocks pulsing in turn | No |
| 506 | Variant Also Negotiates | A maze inside the maze | The server's content negotiation loops | Nested square rings pulsing inward | No |
| 507 | Insufficient Storage | The storeroom is full | The server ran out of disk space | One more item bouncing off a full chest | **Yes** (big model pulls) |
| 508 | Loop Detected | Running in circles | The server found an endless loop | A circle spinning round and round | No |
| 510 | Not Extended | A page of the plans is missing | Needs an extension the server lacks (obsolete) | A block grid with one flickering missing piece | No |
| 511 | Network Authentication Required | The gatekeeper wants a toll | The network (hotel or campus Wi-Fi) wants you to log in first | Signal arcs lighting up while a lock shakes | Only on captive Wi-Fi |

A non-standard code (e.g. 499) shows its family's page (400 or 500) with its
real number.

## Adding a code

Create `codes/<code>.ts`. It is picked up automatically:

```ts
import type { ErrorInfo } from '../types'

export default {
  name: 'Official Name', title: 'The themed headline',
  myth: 'One Daedalus line.',
  block: 'One block-built line.',
  what: 'Plain words: what went wrong.',
  fix: 'Plain words: what to try.',
  art: [
    '............', '............', '............', '............',
    '............', '............', '............', '............',
    '............', '............', '............', '............',
  ],
  css: `
.pix-<code> .px-a { animation: pix-pulse 1.6s ease-in-out infinite; }
`,
} satisfies ErrorInfo
```

The type check (`tsc -b`) catches a missing field. A row of the wrong length
draws a crooked picture, so keep every row the same width as the number of rows.
