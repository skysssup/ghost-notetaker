'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { INSET, toWindow, fromWindow, bubbleWindow, BUBBLE_SIZE, NOTE_MIN } = require('../main/note-geometry');

describe('note window geometry', () => {
  const saved = { x: 100, y: 200, width: 340, height: 280 };

  it('the window is the paper: saved bounds minus the old 8px margin on every side', () => {
    assert.equal(INSET, 8);
    assert.deepEqual(toWindow(saved), { x: 108, y: 208, width: 324, height: 264 });
  });

  it('fromWindow undoes toWindow, so saved bounds keep their v2 meaning', () => {
    assert.deepEqual(fromWindow(toWindow(saved)), saved);
    const live = { x: -40, y: 0, width: NOTE_MIN.width, height: NOTE_MIN.height };
    assert.deepEqual(toWindow(fromWindow(live)), live);
  });

  it('a bubble sits where the paper corner was', () => {
    assert.deepEqual(bubbleWindow(saved), { x: 108, y: 208, ...BUBBLE_SIZE });
    assert.deepEqual(BUBBLE_SIZE, { width: 56, height: 56 });
  });

  it('the smallest note is 220x180', () => {
    assert.deepEqual(NOTE_MIN, { width: 220, height: 180 });
  });
});
