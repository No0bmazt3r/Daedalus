// @ts-nocheck
// Extracted and adapted from Odysseus theme.js.
//
// Beyond the original: every effect reads the shared pointer field, so the
// background reacts to the cursor when the theme's "Reactive" toggle is on.
// `pointerFor` returns an inert value when it is off, which is why the draw
// loops can call it unconditionally.

import { pointerFor, influence } from './pointerField';
import { THEME_CHANGE_EVENT } from './themes';

export function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

export function rgba(hex: string, a: number) {
  const c = hexToRgb(hex);
  return c ? `rgba(${c.r},${c.g},${c.b},${a})` : `rgba(0,0,0,${a})`;
}

/**
 * Size the canvas to the element it is drawn into rather than the viewport —
 * in Daedalus the effects live inside the main content pane, which is
 * narrower than the window whenever the sidebar is open.
 */
function canvasBox(canvas: HTMLCanvasElement) {
  const host = canvas.parentElement;
  const w = host?.clientWidth || window.innerWidth;
  const h = host?.clientHeight || window.innerHeight;
  return { w, h };
}

// getComputedStyle forces a style recalc, so the theme variables are read
// once and reused until the theme actually changes rather than being sampled
// every frame (and, in the ember loop, every particle).
let _varCache: { color: string; scale: number } | null = null;

function themeVars() {
  if (_varCache) return _varCache;
  const s = getComputedStyle(document.documentElement);
  const scale = parseFloat(s.getPropertyValue("--bg-effect-size"));
  _varCache = {
    color:
      s.getPropertyValue("--bg-effect-color").trim() ||
      s.getPropertyValue("--primary").trim() ||
      "#9cdef2",
    scale: isNaN(scale) ? 1 : Math.max(0.2, Math.min(3, scale)),
  };
  return _varCache;
}

if (typeof window !== "undefined") {
  window.addEventListener(THEME_CHANGE_EVENT, () => {
    _varCache = null;
  });
}

/** The colour the user picked for effects, falling back to the accent. */
function effectColor() {
  return themeVars().color;
}

/** Effect size multiplier (0.3..2.5) from the theme's Size slider. */
function effectScale() {
  return themeVars().scale;
}

// ── Synapse background effect ──
// Uses the CSS grid pattern as base, overlays fast-moving small light pulses on grid lines
export function initSynapse(canvas: HTMLCanvasElement, cancelToken: { cancelled: boolean }) {
  
  
  
  
  // Decorative background effect — hide from assistive tech so screen readers
  // don't announce an empty canvas and axe's "region" rule doesn't flag it.
  
  
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const GRID = 24; // matches CSS grid size
  const MAX_PULSES = 20;
  const SPEED_MIN = 2;
  const SPEED_MAX = 22;
  const TRAIL_LEN = 12; // pixels of trailing glow

  let W: number, H: number, cols: number, rows: number, pulses: any[] = [];

  function resize() {
    const _box = canvasBox(canvas); W = _box.w; H = _box.h;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / GRID); rows = Math.ceil(H / GRID);
  }
  resize();
  const _onResize = () => resize();
  window.addEventListener('resize', _onResize);

  function getColor() { return effectColor(); }

  function spawnPulse() {
    const speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
    if (Math.random() > 0.5) {
      // Horizontal — pick a grid row
      const row = Math.floor(Math.random() * (rows + 1));
      pulses.push({ x: -TRAIL_LEN, y: row * GRID, dx: speed, dy: 0 });
    } else {
      // Vertical — pick a grid column
      const col = Math.floor(Math.random() * (cols + 1));
      pulses.push({ x: col * GRID, y: -TRAIL_LEN, dx: 0, dy: speed });
    }
  }

  function draw() {
    if (cancelToken.cancelled) { window.removeEventListener("resize", _onResize); return; }
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);
    const c = getColor();

    // Spawn
    if (pulses.length < MAX_PULSES && Math.random() < 0.12) spawnPulse();

    const ptr = pointerFor(canvas);
    // Moving the cursor fires extra pulses down the grid lines it is nearest,
    // so the network looks like it is conducting from the pointer.
    if (ptr.active && pulses.length < MAX_PULSES + 12 && Math.random() < 0.22 * ptr.energy) {
      const speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
      if (Math.random() > 0.5) {
        pulses.push({ x: ptr.x, y: Math.round(ptr.y / GRID) * GRID, dx: speed, dy: 0 });
      } else {
        pulses.push({ x: Math.round(ptr.x / GRID) * GRID, y: ptr.y, dx: 0, dy: speed });
      }
    }

    // Draw pulses as small bright dots with a short trail
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.x += p.dx; p.y += p.dy;

      // Off screen — remove
      if (p.x > W + TRAIL_LEN || p.y > H + TRAIL_LEN) { pulses.splice(i, 1); continue; }

      // Trail (line gradient fading behind the dot)
      const tx = p.x - (p.dx > 0 ? TRAIL_LEN : 0);
      const ty = p.y - (p.dy > 0 ? TRAIL_LEN : 0);
      const inf = influence(p.x, p.y, ptr, 200);

      const grad = ctx.createLinearGradient(tx, ty, p.x, p.y);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, c);
      ctx.strokeStyle = grad;
      ctx.globalAlpha = 0.35 + inf * 0.45;
      ctx.lineWidth = 1 + inf * 1.4;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      // Bright dot at head — swells as it passes the cursor
      ctx.globalAlpha = 0.55 + inf * 0.45;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.2 + inf * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
  draw();
}

// ── Rain — thin vertical streaks falling ──
export function initRain(canvas: HTMLCanvasElement, cancelToken: { cancelled: boolean }) {
  
  
  
  
  // Decorative background effect — hide from assistive tech so screen readers
  // don't announce an empty canvas and axe's "region" rule doesn't flag it.
  
  
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W: number, H: number;
  const drops: any[] = [];
  const MAX_DROPS = 130;

  function resize() {
    const _box = canvasBox(canvas); W = _box.w; H = _box.h;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  const _onResize = () => resize();
  window.addEventListener('resize', _onResize);

  function getColor() { return effectColor(); }

  function spawn() {
    const len = 20 + Math.random() * 40;
    const speed = 4 + Math.random() * 8;
    drops.push({ x: Math.random() * W, y: -len, len, speed, alpha: 0.32 + Math.random() * 0.28 });
  }

  function draw() {
    if (cancelToken.cancelled) { window.removeEventListener("resize", _onResize); return; }
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);
    const c = getColor();
    // Intensity also controls rain speed + spawn rate (feels slower/lighter when dim)
    const intenCss = 1;
    const inten = isNaN(intenCss) ? 1 : intenCss;
    const speedMult = 0.35 + inten * 0.65;
    const sizeMult = effectScale();

    if (drops.length < MAX_DROPS * inten && Math.random() < 0.6 * inten) spawn();

    const ptr = pointerFor(canvas);

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.y += d.speed * speedMult;
      if (d.y > H + d.len * sizeMult) { drops.splice(i, 1); continue; }

      // The cursor parts the rain — drops slide around it and slow as they go.
      const inf = influence(d.x, d.y, ptr, 150);
      if (inf > 0) {
        const away = d.x >= ptr.x ? 1 : -1;
        d.x += away * inf * 4.5 + ptr.vx * inf * 0.35;
        d.y -= inf * d.speed * 0.45;
      }

      const effLen = d.len * sizeMult;
      const grad = ctx.createLinearGradient(d.x, d.y - effLen, d.x, d.y);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, c);
      ctx.strokeStyle = grad;
      ctx.globalAlpha = d.alpha;
      ctx.lineWidth = 1.3 * Math.min(2, Math.max(0.6, sizeMult));
      ctx.beginPath();
      ctx.moveTo(d.x, d.y - effLen);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  draw();
}

// ── Constellations — static dots that slowly form/dissolve connecting lines ──
export function initConstellations(canvas: HTMLCanvasElement, cancelToken: { cancelled: boolean }) {
  
  
  
  
  // Decorative background effect — hide from assistive tech so screen readers
  // don't announce an empty canvas and axe's "region" rule doesn't flag it.
  
  
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W: number, H: number;
  const STAR_COUNT = 50;
  const CONNECT_DIST = 120;
  let stars: any[] = [];

  function resize() {
    const _box = canvasBox(canvas); W = _box.w; H = _box.h;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (stars.length === 0) initStars();
  }

  function initStars() {
    stars = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.15,
        vy: (Math.random() - 0.5) * 0.15,
        r: 0.8 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  resize();
  const _onResize = () => { resize(); initStars(); };
  window.addEventListener('resize', _onResize);

  function getColor() { return effectColor(); }

  let t = 0;
  function draw() {
    if (cancelToken.cancelled) { window.removeEventListener("resize", _onResize); return; }
    requestAnimationFrame(draw);
    t += 0.01;
    ctx.clearRect(0, 0, W, H);
    const c = getColor();

    const ptr = pointerFor(canvas);

    // Move stars gently, drifting toward the cursor while it is moving
    for (const s of stars) {
      s.x += s.vx; s.y += s.vy;
      if (ptr.active) {
        const pull = influence(s.x, s.y, ptr, 260) * ptr.energy * 0.02;
        s.x += (ptr.x - s.x) * pull;
        s.y += (ptr.y - s.y) * pull;
      }
      if (s.x < 0) s.x = W; if (s.x > W) s.x = 0;
      if (s.y < 0) s.y = H; if (s.y > H) s.y = 0;
    }

    // Draw connections
    ctx.strokeStyle = c;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const dx = stars[i].x - stars[j].x;
        const dy = stars[i].y - stars[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECT_DIST) {
          ctx.globalAlpha = (1 - dist / CONNECT_DIST) * 0.15;
          ctx.beginPath();
          ctx.moveTo(stars[i].x, stars[i].y);
          ctx.lineTo(stars[j].x, stars[j].y);
          ctx.stroke();
        }
      }
    }

    // The cursor itself joins the constellation
    if (ptr.active) {
      for (const s of stars) {
        const dx = s.x - ptr.x;
        const dy = s.y - ptr.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECT_DIST * 1.6) {
          ctx.globalAlpha = (1 - dist / (CONNECT_DIST * 1.6)) * 0.4;
          ctx.beginPath();
          ctx.moveTo(ptr.x, ptr.y);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }
      }
    }

    // Draw stars with subtle twinkle, brighter near the cursor
    ctx.fillStyle = c;
    for (const s of stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * 2 + s.phase);
      const inf = influence(s.x, s.y, ptr, 200);
      ctx.globalAlpha = 0.15 + twinkle * 0.25 + inf * 0.4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1 + inf * 1.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  draw();
}

// ── Noise helper for Perlin effects ──
function _bgNoise2d(x, y) { const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return n - Math.floor(n); }
function _bgSmoothNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = _bgNoise2d(ix, iy), b = _bgNoise2d(ix + 1, iy), cc = _bgNoise2d(ix, iy + 1), d = _bgNoise2d(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (cc - a) * uy + (a - b - cc + d) * ux * uy;
}

// ── Perlin Flow — colored particle streams ──
export function initPerlinFlow(canvas: HTMLCanvasElement, cancelToken: { cancelled: boolean }) {
  
  
  
  
  // Decorative background effect — hide from assistive tech so screen readers
  // don't announce an empty canvas and axe's "region" rule doesn't flag it.
  
  
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W, H, t = 0;
  const particles: any[] = [];
  function resize() {
    const _box = canvasBox(canvas); W = _box.w; H = _box.h;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (particles.length === 0) for (let i = 0; i < 200; i++) particles.push({ x: Math.random() * W, y: Math.random() * H, life: Math.random() });
  }
  resize();
  const _onResize = () => resize();
  window.addEventListener('resize', _onResize);
  function getColor() { return effectColor(); }
  function getBg() { return getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#000000"; }
  let _cachedBg = '', _fadeStyle = '';
  function getFade() {
    const bg = getBg();
    if (bg !== _cachedBg) {
      _cachedBg = bg;
      // Parse hex to rgb for rgba fade
      const { r, g, b } = hexToRgb(bg) || { r: 0, g: 0, b: 0 };
      _fadeStyle = `rgba(${r},${g},${b},0.02)`;
    }
    return _fadeStyle;
  }
  function draw() {
    if (cancelToken.cancelled) { window.removeEventListener("resize", _onResize); return; }
    requestAnimationFrame(draw);
    ctx.fillStyle = getFade();
    ctx.fillRect(0, 0, W, H);
    const c = getColor();
    const ptr = pointerFor(canvas);
    particles.forEach(p => {
      const n = _bgSmoothNoise(p.x * 0.004 + t * 0.0008, p.y * 0.004 + 100);
      let angle = n * Math.PI * 6;
      let speed = 1 + _bgSmoothNoise(p.x * 0.003, p.y * 0.003 + 50) * 1.5;
      // The cursor bends the flow field into a vortex around itself.
      const inf = influence(p.x, p.y, ptr, 240);
      if (inf > 0) {
        const toPtr = Math.atan2(ptr.y - p.y, ptr.x - p.x);
        angle += (toPtr + Math.PI / 2 - angle) * inf * 0.8;
        speed += inf * 2.4;
      }
      p.x += Math.cos(angle) * speed; p.y += Math.sin(angle) * speed; p.life -= 0.001;
      if (p.life <= 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) { p.x = Math.random() * W; p.y = Math.random() * H; p.life = 1; }
      ctx.beginPath(); ctx.arc(p.x, p.y, 1 + inf * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = c; ctx.globalAlpha = p.life * (0.15 + inf * 0.3); ctx.fill();
    });
    ctx.globalAlpha = 1;
    t++;
  }
  draw();
}

// ── Petals — gentle falling flower petals ──
export function initPetals(canvas: HTMLCanvasElement, cancelToken: { cancelled: boolean }) {
  
  
  
  
  // Decorative background effect — hide from assistive tech so screen readers
  // don't announce an empty canvas and axe's "region" rule doesn't flag it.
  
  
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W: number, H: number;
  const petals: any[] = [];
  function makePetal() {
    return {
      x: Math.random() * W, y: -10 - Math.random() * 40,
      size: 3 + Math.random() * 5, rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.03, vy: 0.3 + Math.random() * 0.6,
      drift: Math.random() * Math.PI * 2, driftSpeed: 0.008 + Math.random() * 0.012,
      wobble: 0.3 + Math.random() * 0.8
    };
  }
  function resize() {
    const _box = canvasBox(canvas); W = _box.w; H = _box.h;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (petals.length === 0) for (let i = 0; i < 30; i++) { const p = makePetal(); p.y = Math.random() * H; petals.push(p); }
  }
  resize();
  const _onResize = () => resize();
  window.addEventListener('resize', _onResize);
  function getColor() { return effectColor(); }
  function draw() {
    if (cancelToken.cancelled) { window.removeEventListener("resize", _onResize); return; }
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);
    const c = getColor();
    const sz = effectScale();
    const ptr = pointerFor(canvas);
    petals.forEach(p => {
      p.y += p.vy; p.rot += p.vr; p.drift += p.driftSpeed;
      p.x += Math.sin(p.drift) * p.wobble;
      // Sweeping the cursor through them acts like a gust.
      const inf = influence(p.x, p.y, ptr, 170);
      if (inf > 0) {
        const dx = p.x - ptr.x;
        const dy = p.y - ptr.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        p.x += (dx / d) * inf * 5 + ptr.vx * inf * 0.5;
        p.y += (dy / d) * inf * 3 + ptr.vy * inf * 0.4;
        p.rot += inf * 0.12;
      }
      if (p.y > H + 15) Object.assign(p, makePetal());
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = 0.2;
      // petal shape — two overlapping ellipses
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(-p.size * 0.2 * sz, 0, p.size * 0.6 * sz, p.size * 0.3 * sz, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.15;
      ctx.beginPath(); ctx.ellipse(p.size * 0.2 * sz, 0, p.size * 0.6 * sz, p.size * 0.3 * sz, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    ctx.globalAlpha = 1;
  }
  draw();
}

// ── Sparkles — twinkling star-shaped sparkles ──
export function initSparkles(canvas: HTMLCanvasElement, cancelToken: { cancelled: boolean }) {
  
  
  
  
  // Decorative background effect — hide from assistive tech so screen readers
  // don't announce an empty canvas and axe's "region" rule doesn't flag it.
  
  
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W: number, H: number;
  const sparkles = [];
  function makeSpark() {
    return { x: Math.random() * W, y: Math.random() * H, size: 2 + Math.random() * 5, phase: Math.random() * Math.PI * 2, speed: 0.015 + Math.random() * 0.03, life: 0.5 + Math.random() * 0.5 };
  }
  function resize() {
    const _box = canvasBox(canvas); W = _box.w; H = _box.h;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sparkles.length === 0) for (let i = 0; i < 35; i++) sparkles.push(makeSpark());
  }
  resize();
  const _onResize = () => resize();
  window.addEventListener('resize', _onResize);
  function getColor() { return effectColor(); }
  function drawStar(x, y, r, c, alpha) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = c; ctx.globalAlpha = alpha;
    // 4-point star
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.15, -r * 0.15, r, 0);
    ctx.quadraticCurveTo(r * 0.15, r * 0.15, 0, r);
    ctx.quadraticCurveTo(-r * 0.15, r * 0.15, -r, 0);
    ctx.quadraticCurveTo(-r * 0.15, -r * 0.15, 0, -r);
    ctx.fill();
    ctx.restore();
  }
  function draw() {
    if (cancelToken.cancelled) { window.removeEventListener("resize", _onResize); return; }
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, W, H);
    const c = getColor();
    const sizeMult = effectScale();
    const ptr = pointerFor(canvas);
    // A trail of sparkles follows a moving cursor.
    if (ptr.active && Math.random() < 0.3 * ptr.energy) {
      const s = makeSpark();
      s.x = ptr.x + (Math.random() - 0.5) * 60;
      s.y = ptr.y + (Math.random() - 0.5) * 60;
      s.phase = 0;
      if (sparkles.length < 60) sparkles.push(s);
    }
    sparkles.forEach(s => {
      s.phase += s.speed;
      const twinkle = Math.sin(s.phase);
      const inf = influence(s.x, s.y, ptr, 180);
      const alpha = Math.max(0, twinkle) * (0.25 + inf * 0.5) * s.life;
      const scale = (0.5 + Math.max(0, twinkle) * 0.5) * (1 + inf * 1.2);
      if (alpha > 0.01) drawStar(s.x, s.y, s.size * scale * sizeMult, c, alpha);
      // respawn when cycle completes
      if (s.phase > Math.PI * 6) {
        // Keep the pool from growing without bound once cursor trails add to it.
        if (sparkles.length > 35) { sparkles.splice(sparkles.indexOf(s), 1); return; }
        Object.assign(s, makeSpark());
      }
    });
    ctx.globalAlpha = 1;
  }
  draw();
}

// ── Embers — warm particles rising with glow and occasional spark bursts ──
export function initEmbers(canvas: HTMLCanvasElement, cancelToken: { cancelled: boolean }) {
  
  
  
  
  // Decorative background effect — hide from assistive tech so screen readers
  // don't announce an empty canvas and axe's "region" rule doesn't flag it.
  
  
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W: number, H: number;
  const embers: any[] = [];
  function makeEmber() {
    return {
      x: Math.random() * W,
      y: H + Math.random() * 40,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -0.3 - Math.random() * 0.8,
      r: 0.3 + Math.random() * 0.6,
      life: 0,
      maxLife: 220 + Math.random() * 220,
      wobble: Math.random() * Math.PI * 2,
      spark: false,
    };
  }
  function resize() {
    const _box = canvasBox(canvas); W = _box.w; H = _box.h;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (embers.length === 0) {
      for (let i = 0; i < 60; i++) { const e = makeEmber(); e.y = Math.random() * H; e.life = Math.random() * e.maxLife; embers.push(e); }
    }
  }
  resize();
  const _onResize = () => resize();
  window.addEventListener('resize', _onResize);
  function getColor() { return effectColor(); }
  function rgba(hex, a) {
    const { r, g, b } = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
    return `rgba(${r},${g},${b},${a})`;
  }
  function draw() {
    if (cancelToken.cancelled) { window.removeEventListener("resize", _onResize); return; }
    requestAnimationFrame(draw);
    // Fade previous frame (destination-out keeps canvas transparent where no embers)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const color = getColor();
    const ptr = pointerFor(canvas);
    const sz = effectScale();
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.wobble += 0.03;
      e.x += e.vx + Math.sin(e.wobble) * 0.5;
      e.y += e.vy;
      // Moving through them fans the embers outward like a draft.
      const inf = influence(e.x, e.y, ptr, 190);
      if (inf > 0) {
        const dx = e.x - ptr.x;
        const dy = e.y - ptr.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        e.x += (dx / d) * inf * 3.5 + ptr.vx * inf * 0.4;
        e.y += (dy / d) * inf * 2.5 - inf * 1.2;
        if (!e.spark && inf > 0.55 && Math.random() < 0.08) e.spark = true;
      }
      e.life++;
      if (e.life > e.maxLife || e.y < -20) {
        embers.splice(i, 1);
        if (embers.length < 70) embers.push(makeEmber());
        continue;
      }
      if (!e.spark && Math.random() < 0.003) e.spark = true;
      const lifeRatio = e.life / e.maxLife;
      const fade = Math.min(1, Math.min(lifeRatio * 4, (1 - lifeRatio) * 3));
      const r = e.r * (e.spark ? 2.4 : 1) * sz;
      const a = (e.spark ? 0.9 : 0.55) * fade;
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r * 4);
      g.addColorStop(0, rgba(color, a));
      g.addColorStop(0.4, rgba(color, a * 0.3));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(e.x - r * 4, e.y - r * 4, r * 8, r * 8);
      ctx.fillStyle = rgba('#ffffff', a * 0.6);
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      e.spark = false;
    }
    if (Math.random() < 0.015) {
      const bx = Math.random() * W;
      for (let i = 0; i < 5; i++) {
        const e = makeEmber();
        e.x = bx + (Math.random() - 0.5) * 40;
        e.y = H - 10;
        e.vy *= 1.5;
        embers.push(e);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  draw();
}

