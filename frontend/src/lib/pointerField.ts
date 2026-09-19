// Shared pointer state for the background effects — **disabled**.
//
// The effects used to follow the cursor: particles leaning toward it, a ripple
// under it, motion that rose and fell with how fast it moved. It was removed
// because a background that responds to the pointer is a background competing
// with whatever the pointer is actually doing, and on a monitoring console the
// answer on screen should be the only thing moving for a reason.
//
// The module is kept rather than deleted, and `pointerFor()` now always returns
// `IDLE`. Every effect already handles an absent pointer — that is the path
// taken before the cursor first moves, and on touch devices — so the animations
// run exactly as they do at rest, with no per-effect change and nothing to
// unpick if this is ever wanted back.
//
// The listener is never attached, so there is no `pointermove` handler running
// at all: this is a removal, not a flag that leaves the cost behind.

interface PointerState {
  /** Viewport coordinates of the pointer. */
  clientX: number;
  clientY: number;
  /** Smoothed pointer velocity, px/frame-ish. */
  vx: number;
  vy: number;
  /** Falls from 1 to 0 over ~1.2s after the pointer stops moving. */
  energy: number;
  /** False until the pointer has been seen, and after it leaves the window. */
  present: boolean;
}

const state: PointerState = {
  clientX: -9999,
  clientY: -9999,
  vx: 0,
  vy: 0,
  energy: 0,
  present: false,
};

let listening = false;
let lastMove = 0;

function ensureListening() {
  // Deliberately empty. Kept so the call sites read the same and the intent is
  // visible here rather than inferred from four deleted lines.
  if (listening) return;
  listening = true;
}

/** Always false — pointer reactivity was removed. See the module note. */
export function reactiveEnabled(): boolean {
  return false;
}

// Read every frame by the draw loops, and a layout if computed fresh. Cached
// and invalidated on the events that can actually change it.
let rectCache: { el: HTMLCanvasElement; rect: DOMRect; at: number } | null = null;
const RECT_TTL_MS = 250;

function canvasRect(canvas: HTMLCanvasElement): DOMRect {
  const now = performance.now();
  if (rectCache && rectCache.el === canvas && now - rectCache.at < RECT_TTL_MS) {
    return rectCache.rect;
  }
  const rect = canvas.getBoundingClientRect();
  rectCache = { el: canvas, rect, at: now };
  return rect;
}

if (typeof window !== 'undefined') {
  // The sidebar sliding open moves the pane without a resize event, so the
  // rect cache is short-lived rather than invalidated only here.
  window.addEventListener('resize', () => {
    rectCache = null;
  });
}

export interface LocalPointer {
  /** Pointer position in canvas-local pixels. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0 when the pointer is idle or reactivity is off, up to 1 while moving. */
  energy: number;
  active: boolean;
}

const IDLE: LocalPointer = { x: -9999, y: -9999, vx: 0, vy: 0, energy: 0, active: false };

/**
 * Read the pointer in the canvas's own coordinate space. Returns an inert
 * value when reactivity is disabled, so an effect can call this every frame
 * and simply get "nothing is happening".
 */
export function pointerFor(canvas: HTMLCanvasElement): LocalPointer {
  ensureListening();
  if (!state.present || !reactiveEnabled()) return IDLE;

  // Bleed energy off once the pointer goes still, so the effect settles
  // rather than staying permanently deformed around a parked cursor.
  const idleFor = performance.now() - lastMove;
  const energy = Math.max(0, 1 - idleFor / 1200);
  if (energy <= 0) {
    state.vx *= 0.9;
    state.vy *= 0.9;
  }

  const r = canvasRect(canvas);
  const x = state.clientX - r.left;
  const y = state.clientY - r.top;
  // Slightly outside still counts — an effect should react as the pointer
  // approaches the pane edge, not snap off at the boundary.
  const margin = 80;
  const active = x > -margin && y > -margin && x < r.width + margin && y < r.height + margin;
  if (!active) return IDLE;

  return { x, y, vx: state.vx, vy: state.vy, energy, active: true };
}

/** Smooth falloff: 1 at the pointer, 0 at `radius` and beyond. */
export function influence(
  px: number,
  py: number,
  pointer: LocalPointer,
  radius: number
): number {
  if (!pointer.active) return 0;
  const dx = px - pointer.x;
  const dy = py - pointer.y;
  const d2 = dx * dx + dy * dy;
  const r2 = radius * radius;
  if (d2 >= r2) return 0;
  const t = 1 - Math.sqrt(d2) / radius;
  return t * t; // ease-in so the effect is tight around the cursor
}
