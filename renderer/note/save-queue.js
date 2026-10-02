'use strict';

/**
 * Merge successive debounced note patches so title/content/etc. edits
 * within the debounce window all reach the store.
 * On flush failure the pending patch is restored so the note stays dirty.
 */
function createSaveQueue({ flush, delayMs = 160 }) {
  let timer = null;
  let pending = null;
  let lastError = null;
  let inFlight = null;

  function queue(patch) {
    pending = Object.assign(pending || {}, patch);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flushNow().catch(() => {});
    }, delayMs);
  }

  function pendingPatch() {
    return pending ? { ...pending } : null;
  }

  function getLastError() {
    return lastError;
  }

  function cancel() {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  }

  /** Send any pending patch immediately. Restores pending on failure. */
  function flushNow() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (inFlight) {
      // Chain after the in-flight flush so quit/hide wait for the latest patches.
      return inFlight.then(() => flushNow());
    }
    const toSend = pending;
    if (!toSend) return Promise.resolve(null);
    pending = null;
    const run = Promise.resolve()
      .then(() => flush(toSend))
      .then((result) => {
        lastError = null;
        return result;
      })
      .catch((err) => {
        // Keep dirty: merge failed patch back so a later retry can succeed.
        pending = Object.assign({}, toSend, pending || {});
        lastError = err;
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });
    inFlight = run;
    return run;
  }

  function hasPending() {
    return pending != null || inFlight != null || timer != null;
  }

  return { queue, pendingPatch, cancel, flushNow, getLastError, hasPending };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSaveQueue };
}

if (typeof window !== 'undefined') {
  window.GhostSaveQueue = { createSaveQueue };
}
