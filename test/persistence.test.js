'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { flushPendingNotes } = require('../main/persistence');

test('does not acknowledge persistence when a renderer fails to flush', async () => {
  let saved = false;
  await assert.rejects(flushPendingNotes({ flushAllPending: async () => [{ id: 'a', ok: false, message: 'timeout' }] }, { flush: () => { saved = true; } }), /timeout/);
  assert.equal(saved, false);
});
test('flushes renderers before the store and propagates disk failures', async () => {
  const order = [];
  await assert.rejects(flushPendingNotes({ flushAllPending: async () => { order.push('renderer'); return [{ ok: true }]; } }, { flush: () => { order.push('store'); throw new Error('disk full'); } }), /disk full/);
  assert.deepEqual(order, ['renderer', 'store']);
});
