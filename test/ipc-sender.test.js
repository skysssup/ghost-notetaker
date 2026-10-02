'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { assertSenderWindow, assertSenderIsOneOf } = require('../main/ipc-guards');

function fakeWin(id) {
  const webContents = { id, isDestroyed: () => false };
  return {
    id,
    webContents,
    isDestroyed: () => false
  };
}

describe('ipc sender guards', () => {
  it('accepts matching sender window', () => {
    const win = fakeWin(1);
    const event = { sender: win.webContents };
    assert.equal(assertSenderWindow(event, win), win);
  });

  it('rejects mismatched or destroyed senders', () => {
    const win = fakeWin(1);
    const other = fakeWin(2);
    assert.throws(() => assertSenderWindow({ sender: other.webContents }, win), /Unauthorized/);
    assert.throws(() => assertSenderWindow({ sender: win.webContents }, null), /Unauthorized/);
    const dead = {
      isDestroyed: () => true,
      webContents: { isDestroyed: () => true }
    };
    assert.throws(() => assertSenderWindow({ sender: dead.webContents }, dead), /Unauthorized/);
  });

  it('assertSenderIsOneOf finds the owning window', () => {
    const a = fakeWin(1);
    const b = fakeWin(2);
    assert.equal(assertSenderIsOneOf({ sender: b.webContents }, [a, b]), b);
    assert.throws(() => assertSenderIsOneOf({ sender: fakeWin(3).webContents }, [a, b]), /Unauthorized/);
  });
});
