'use strict';

async function flushPendingNotes(notes, store) {
  const results = notes && notes.flushAllPending ? await notes.flushAllPending(2000) : [];
  const failed = results.find(result => result.ok === false);
  if (failed) throw new Error(`Could not save note ${failed.id}: ${failed.message || 'save failed'}`);
  if (store) store.flush();
}

module.exports = { flushPendingNotes };
