import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, activeActions } from '../src/timeline.ts';

test('timestamps are episode local; equal timestamps highlight together through the next boundary', () => {
  const timeline = buildTimeline({ episodes: [
    { scenes: [{ scene_id: 's1', actions: [
      { extend: { timestamp: '00:01.250' } }, { extend: { timestamp: '00:01.250' } },
      { extend: { timestamp: '00:03' } }, { content: 'untimed' }, { extend: { timestamp: 'invalid' } },
    ] }] },
    { scenes: [{ scene_id: 's2', actions: [{ extend: { timestamp: '00:00' } }] }] },
  ] });
  assert.equal(timeline[0].length, 3);
  assert.deepEqual(activeActions(timeline[0], 1), []);
  assert.deepEqual(activeActions(timeline[0], 1.25).map(a => a.target.actionIndex), [0, 1]);
  assert.deepEqual(activeActions(timeline[0], 2.9).map(a => a.target.actionIndex), [0, 1]);
  assert.deepEqual(activeActions(timeline[0], 3).map(a => a.target.actionIndex), [2]);
  assert.deepEqual(activeActions(timeline[0], 1.5).map(a => a.target.actionIndex), [0, 1]);
  assert.equal(activeActions(timeline[1], 0)[0].target.episodeIdx, 1);
});
