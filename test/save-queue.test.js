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
});
