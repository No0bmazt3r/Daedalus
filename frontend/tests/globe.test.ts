/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IDENTITY, apply, dragRotate, multiply, project, sphereLayout, towardsFront, type Vec3,
} from '../src/lib/globe.ts';

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('every node lands on the sphere, linked nodes closer than unlinked ones', () => {
  // Two rings of five, joined by one edge.
  const links: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [5, 6], [6, 7], [7, 8], [8, 9], [9, 5], [0, 5]];
  const p = sphereLayout(10, links);
  for (const v of p) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
  const linked = links.reduce((s, [a, b]) => s + dist(p[a], p[b]), 0) / links.length;
  const across = dist(p[2], p[7]);
  assert.ok(linked < across, `linked ${linked} vs across ${across}`);
});

test('the layout is the same every time', () => {
  assert.deepEqual(sphereLayout(8, [[0, 1], [2, 3]]), sphereLayout(8, [[0, 1], [2, 3]]));
});

test('dragging right turns the front of the globe right, dragging down turns it down', () => {
  const front: Vec3 = [0, 0, 1];
  assert.ok(project(apply(dragRotate(IDENTITY, 40, 0), front), 100).x > 0);
  assert.ok(project(apply(dragRotate(IDENTITY, 0, 40), front), 100).y > 0);
});

test('towardsFront brings a point at the back round to face the viewer', () => {
  let m = IDENTITY;
  const v: Vec3 = [0.3, -0.4, -0.866];
  for (let i = 0; i < 200; i++) {
    const step = towardsFront(apply(m, v), 0.2);
    if (!step) break;
    m = multiply(step, m);
  }
  assert.ok(apply(m, v)[2] > 0.999);
});
