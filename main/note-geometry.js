'use strict';

/**
 * The note window is the paper: no transparent margin around it (it used to hold a
 * drop shadow, which the flat design dropped). Saved bounds keep the meaning they had
 * in v2, the paper plus 8px on every side, so a note's paper stays exactly where it
 * was and old data needs no migration.
 */
const INSET = 8;
const toWindow = (b) => ({
  x: b.x + INSET,
  y: b.y + INSET,
  width: b.width - 2 * INSET,
  height: b.height - 2 * INSET
});
const fromWindow = (b) => ({
  x: b.x - INSET,
  y: b.y - INSET,
  width: b.width + 2 * INSET,
  height: b.height + 2 * INSET
});

/** Window of a note collapsed into a bubble: just the 56px circle, where the paper's corner was. */
const BUBBLE_SIZE = { width: 56, height: 56 };
const bubbleWindow = (b) => ({ x: b.x + INSET, y: b.y + INSET, ...BUBBLE_SIZE });
/** Smallest note window (the paper), the size the tiny-note layout is designed for. */
const NOTE_MIN = { width: 220, height: 180 };

module.exports = { INSET, toWindow, fromWindow, BUBBLE_SIZE, bubbleWindow, NOTE_MIN };
