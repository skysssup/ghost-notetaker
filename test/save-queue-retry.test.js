'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createSaveQueue } = require('../renderer/note/save-queue');

describe('save queue failure retention', () => {
  it('restores pending patch when flush rejects', async () => {
    let calls = 0;
    const q = createSaveQueue({
      delayMs: 5000,
      flush: async () => {
        calls += 1;
        throw new Error('disk full');
      }
    });
    q.queue({ title: 'A' });
    q.queue({ content: 'body' });
    await assert.rejects(() => q.flushNow(), /disk full/);
    assert.equal(calls, 1);
    assert.deepEqual(q.pendingPatch(), { title: 'A', content: 'body' });
    assert.match(String(q.getLastError().message), /disk full/);

    // Retry path: succeed on second attempt
    let succeed = false;
    const q2 = createSaveQueue({
      delayMs: 5000,
      flush: async (patch) => {
        if (!succeed) {
          succeed = true;
          throw new Error('temp');
        }
        return patch;
      }
    });
    q2.queue({ title: 'Retry' });
    await assert.rejects(() => q2.flushNow(), /temp/);
    assert.ok(q2.pendingPatch());
    const result = await q2.flushNow();
    assert.deepEqual(result, { title: 'Retry' });
    assert.equal(q2.pendingPatch(), null);
  });

  it('hasPending is true while debounce timer is armed', async () => {
    const q = createSaveQueue({
      delayMs: 100,
      flush: async () => null
    });
    q.queue({ title: 'x' });
    assert.equal(q.hasPending(), true);
    await q.flushNow();
    assert.equal(q.hasPending(), false);
  });
});
