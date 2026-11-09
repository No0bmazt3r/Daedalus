/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { greeting } from '../src/lib/greeting.ts';

const at = (h: number) => new Date(2026, 10, 10, h, 30);

test('time of day, with the name or the default', () => {
  assert.equal(greeting('Sharvin', false, at(9)), 'Good morning, Sharvin');
  assert.equal(greeting('Sharvin', false, at(13)), 'Good afternoon, Sharvin');
  assert.equal(greeting(null, false, at(19)), 'Good evening, Operator');
  assert.equal(greeting('  ', false, at(2)), 'Working late, Operator');
});

test('incognito says so, whatever the hour', () => {
  assert.equal(greeting('Sharvin', true, at(9)), 'Off the record, Sharvin');
});
