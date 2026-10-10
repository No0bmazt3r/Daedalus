/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reflowPassage } from '../src/lib/passage.ts';

test('PDF line breaks inside a sentence are joined; real breaks are kept', () => {
  const text = 'responsible for the\nprimary function of\nthe amine: absorb gas.\n\nThese reactions underscore two concepts:\n1. Equation 1 is the\nmechanism.\nEquation 2 shows it.';
  assert.deepEqual(reflowPassage(text), [
    'responsible for the primary function of the amine: absorb gas.',
    'These reactions underscore two concepts:\n1. Equation 1 is the mechanism.\nEquation 2 shows it.',
  ]);
});

test('a word hyphenated across a line break is rejoined', () => {
  assert.deepEqual(reflowPassage('chemi-\ncally trapped'), ['chemically trapped']);
});
