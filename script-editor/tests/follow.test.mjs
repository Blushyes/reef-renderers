import test from 'node:test';
import assert from 'node:assert/strict';
import { followOffset, scrollEase } from '../src/use-playback-follow.ts';

test('playback leaves readable actions stationary and advances at the lower 20% boundary', () => {
  assert.equal(followOffset(790, 1000, false), 0);
  assert.equal(followOffset(800, 1000, false), 700);
  assert.equal(followOffset(1200, 1000, false), 1100);
  assert.equal(followOffset(400, 500, false), 350);
});

test('resume and backwards seeks return the action to the upper 10%', () => {
  assert.equal(followOffset(500, 1000, true), 400);
  assert.equal(followOffset(-100, 1000, false), -200);
  assert.equal(followOffset(100, 1000, true), 0);
});

test('scroll easing moves decisively from the start and settles at the target', () => {
  assert.equal(scrollEase(0), 0);
  assert.equal(scrollEase(1), 1);
  assert.equal(scrollEase(0.5), 0.9375);
  const values = Array.from({ length: 101 }, (_, i) => scrollEase(i / 100));
  assert.ok(values.every((value, i) => value >= 0 && value <= 1 && (!i || value >= values[i - 1])));
  assert.ok(scrollEase(0.1) > 0.3);
  assert.ok(scrollEase(0.25) > 0.65);
  assert.ok(scrollEase(0.9) > 0.98);
});
