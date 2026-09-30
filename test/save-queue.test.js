'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createSaveQueue } = require('../renderer/note/save-queue');

describe('save queue', () => {
  it('merges patches within the debounce window', async () => {
    const flushed = [];
    const q = createSaveQueue({
      delayMs: 20,
      flush: (patch) => {
        flushed.push(patch);
      }
    });
    q.queue({ title: 'A' });
    q.queue({ content: 'body' });
    q.queue({ title: 'B' });
    assert.deepEqual(q.pendingPatch(), { title: 'B', content: 'body' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(flushed.length, 1);
    assert.deepEqual(flushed[0], { title: 'B', content: 'body' });
    assert.equal(q.pendingPatch(), null);
  });

  it('flushNow sends pending immediately and clears the timer', async () => {
    const flushed = [];
    const q = createSaveQueue({
      delayMs: 5000,
      flush: (patch) => {
        flushed.push(patch);
        return Promise.resolve('ok');
      }
    });
    q.queue({ title: 'draft' });
    q.queue({ content: 'unsaved' });
    assert.ok(q.pendingPatch());
    const result = await q.flushNow();
    assert.equal(result, 'ok');
    assert.equal(flushed.length, 1);
    assert.deepEqual(flushed[0], { title: 'draft', content: 'unsaved' });
    assert.equal(q.pendingPatch(), null);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(flushed.length, 1);
  });

  it('flushNow is a no-op when nothing is pending', async () => {
    let calls = 0;
    const q = createSaveQueue({
      delayMs: 10,
      flush: () => {
        calls += 1;
      }
    });
    await q.flushNow();
    assert.equal(calls, 0);
  });
});
