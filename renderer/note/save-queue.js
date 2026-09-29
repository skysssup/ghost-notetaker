'use strict';

/**
 * Merge successive debounced note patches so title/content/etc. edits
 * within the debounce window all reach the store.
 */
function createSaveQueue({ flush, delayMs = 160 }) {
  let timer = null;
  let pending = null;

  function queue(patch) {
    pending = Object.assign(pending || {}, patch);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const toSend = pending;
      pending = null;
      if (!toSend) return;
      Promise.resolve(flush(toSend)).catch(() => {});
    }, delayMs);
  }

  function pendingPatch() {
    return pending ? { ...pending } : null;
  }

  function cancel() {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  }

  return { queue, pendingPatch, cancel };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSaveQueue };
}

if (typeof window !== 'undefined') {
  window.GhostSaveQueue = { createSaveQueue };
}
