/**
 * The knowledge graph laid out on a sphere — pure maths, no React, so
 * `tests/globe.test.ts` can pin it.
 *
 * Every node sits on the surface of a unit sphere. Linked nodes pull towards
 * each other, all nodes push apart, and after every step each node is put back
 * on the surface. Clusters come out as regions of the globe, and turning the
 * globe brings any region to the front — so a dense graph never has to be
 * squeezed into one flat frame.
 *
 * Deterministic: it starts from a Fibonacci lattice, not random positions, so
 * the same graph lands the same way every time it is opened.
 */

export type Vec3 = [number, number, number]
/** Row-major 3x3 rotation. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/**
 * Positions on the unit sphere, one per node, in input order. `links` are index pairs.
 *
 * O(n² · iterations). 62 nodes take ~40ms. ponytail: all-pairs repulsion,
 * switch to a Barnes-Hut octree if the graph grows past ~500 nodes.
 */
export function sphereLayout(n: number, links: [number, number][], iterations = 300): Vec3[] {
  const p: Vec3[] = Array.from({ length: n }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(1 - y * y)
    const t = i * Math.PI * (3 - Math.sqrt(5))
    return [r * Math.cos(t), y, r * Math.sin(t)]
  })
  // Ideal link length: shorter for a bigger graph, so a cluster stays a region
  // rather than wrapping the whole globe.
  const rest = Math.min(0.6, 2.2 / Math.sqrt(Math.max(n, 1)))
  const repel = rest * rest * 0.08

  for (let it = 0; it < iterations; it++) {
    const force: Vec3[] = p.map(() => [0, 0, 0])
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = p[i][0] - p[j][0], dy = p[i][1] - p[j][1], dz = p[i][2] - p[j][2]
        const k = repel / (dx * dx + dy * dy + dz * dz + 1e-4)
        force[i][0] += dx * k; force[i][1] += dy * k; force[i][2] += dz * k
        force[j][0] -= dx * k; force[j][1] -= dy * k; force[j][2] -= dz * k
      }
    }
    for (const [i, j] of links) {
      if (i === j) continue
      const dx = p[j][0] - p[i][0], dy = p[j][1] - p[i][1], dz = p[j][2] - p[i][2]
      const len = Math.hypot(dx, dy, dz) || 1e-6
      const k = (0.3 * (len - rest)) / len
      force[i][0] += dx * k; force[i][1] += dy * k; force[i][2] += dz * k
      force[j][0] -= dx * k; force[j][1] -= dy * k; force[j][2] -= dz * k
    }
    // Capped step that cools over the run, then back onto the surface.
    const cap = 0.08 * (1 - it / iterations) + 0.005
    for (let i = 0; i < n; i++) {
      const size = Math.hypot(...force[i])
      const m = size > cap ? cap / size : 1
      const q: Vec3 = [p[i][0] + force[i][0] * m, p[i][1] + force[i][1] * m, p[i][2] + force[i][2] * m]
      const len = Math.hypot(...q) || 1
      p[i] = [q[0] / len, q[1] / len, q[2] / len]
    }
  }
  return p
}

export function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

export function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return out
}

/** Rotation by `angle` radians about the unit `axis` (Rodrigues). */
export function axisAngle([x, y, z]: Vec3, angle: number): Mat3 {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]
}

/**
 * A screen drag of (dx, dy) pixels as a rotation, applied on top of `m`.
 * Dragging right turns the front of the globe right; dragging down tips it down.
 */
export function dragRotate(m: Mat3, dx: number, dy: number, pixelsPerRadian = 180): Mat3 {
  const len = Math.hypot(dx, dy)
  if (!len) return m
  // The axis is the drag turned 90° in the screen plane: right turns about +y,
  // down about +x (screen y points down, world y up, which cancels out).
  return multiply(axisAngle([dy / len, dx / len, 0], len / pixelsPerRadian), m)
}

/**
 * The step that turns the globe so `v` (already rotated) moves towards the viewer
 * (0, 0, 1), covering `fraction` of the remaining angle. Returns null once it is there.
 */
export function towardsFront(v: Vec3, fraction: number): Mat3 | null {
  const len = Math.hypot(...v) || 1
  const u: Vec3 = [v[0] / len, v[1] / len, v[2] / len]
  const angle = Math.acos(Math.max(-1, Math.min(1, u[2])))
  if (angle < 0.003) return null
  // axis = u × (0,0,1) = (u.y, -u.x, 0); when u is straight behind, any axis in the screen plane works.
  const ax = Math.hypot(u[1], u[0]) < 1e-6 ? ([0, 1, 0] as Vec3) : ([u[1], -u[0], 0] as Vec3)
  const alen = Math.hypot(...ax)
  return axisAngle([ax[0] / alen, ax[1] / alen, 0], angle * fraction)
}

/** Unit vector of the mean of `points`, or null when they cancel out. */
export function centroid(points: Vec3[]): Vec3 | null {
  const sum = points.reduce<Vec3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
  const len = Math.hypot(...sum)
  return len < 1e-6 ? null : [sum[0] / len, sum[1] / len, sum[2] / len]
}

/** Camera distance in sphere radii. Closer exaggerates depth; 3 reads as a globe without fish-eye. */
export const CAMERA = 3

/**
 * Perspective projection of a rotated point on a sphere of `radius` units.
 * `scale` grows towards the viewer; `depth` is 0 at the back and 1 at the front.
 */
export function project(v: Vec3, radius: number): { x: number; y: number; scale: number; depth: number } {
  const scale = CAMERA / (CAMERA - v[2])
  // World y is up, SVG y is down.
  return { x: v[0] * radius * scale, y: -v[1] * radius * scale, scale, depth: (v[2] + 1) / 2 }
}
