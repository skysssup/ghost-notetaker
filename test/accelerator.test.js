'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAccelerator,
  formatAccelerator,
  matchesAccelerator
} = require('../main/accelerator');

const key = (k, mods = {}) => ({
  type: 'keyDown',
  key: k.length === 1 ? k.toLowerCase() : k,
  code: /^[a-z]$/i.test(k) ? `Key${k.toUpperCase()}` : /^[0-9]$/.test(k) ? `Digit${k}` : k,
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods
});

describe('normalizeAccelerator', () => {
  it('canonicalizes aliases and modifier order', () => {
    assert.equal(normalizeAccelerator('shift+cmdorctrl+n'), 'CommandOrControl+Shift+N');
    assert.equal(normalizeAccelerator('Ctrl+Option+f5'), 'Control+Alt+F5');
    assert.equal(normalizeAccelerator(' Alt + Space '), 'Alt+Space');
  });

  it('keeps an empty string as an intentionally cleared binding', () => {
    assert.equal(normalizeAccelerator(''), '');
    assert.equal(normalizeAccelerator('   '), '');
  });

  it('rejects bindings that would swallow ordinary typing or are malformed', () => {
    assert.equal(normalizeAccelerator('N'), null);
    assert.equal(normalizeAccelerator('Shift+N'), null);
    assert.equal(normalizeAccelerator('Ctrl+N+M'), null);
    assert.equal(normalizeAccelerator('Ctrl+Shift'), null);
    assert.equal(normalizeAccelerator('Ctrl+Enter'), null);
    assert.equal(normalizeAccelerator(42), null);
    assert.equal(normalizeAccelerator(`Ctrl+${'x'.repeat(80)}`), null);
  });
});

describe('formatAccelerator', () => {
  it('uses symbols on macOS and names elsewhere', () => {
    assert.equal(formatAccelerator('CommandOrControl+Alt+Shift+N', 'darwin'), '⌥⇧⌘N');
    assert.equal(formatAccelerator('CommandOrControl+Alt+Shift+N', 'win32'), 'Ctrl+Alt+Shift+N');
    assert.equal(formatAccelerator('Super+Up', 'linux'), 'Super+Up');
    assert.equal(formatAccelerator('', 'linux'), '');
  });
});

describe('matchesAccelerator', () => {
  it('maps CommandOrControl to Cmd on macOS and Ctrl elsewhere, exactly', () => {
    assert.equal(matchesAccelerator(key('n', { meta: true, shift: true }), 'CommandOrControl+Shift+N', 'darwin'), true);
    assert.equal(matchesAccelerator(key('n', { control: true, shift: true }), 'CommandOrControl+Shift+N', 'darwin'), false);
    assert.equal(matchesAccelerator(key('n', { control: true, shift: true }), 'CommandOrControl+Shift+N', 'linux'), true);
    assert.equal(matchesAccelerator(key('n', { control: true, shift: true, alt: true }), 'CommandOrControl+Shift+N', 'linux'), false);
  });

  it('matches digits, arrows, and space by key code', () => {
    assert.equal(matchesAccelerator({ ...key('1', { control: true, shift: true }), key: '!' }, 'Ctrl+Shift+1', 'linux'), true);
    assert.equal(matchesAccelerator(key('ArrowUp', { alt: true }), 'Alt+Up', 'win32'), true);
    assert.equal(matchesAccelerator({ ...key(' ', { control: true }), code: 'Space' }, 'Ctrl+Space', 'linux'), true);
  });

  it('matches letters typed with Option on macOS through the key code', () => {
    const optionN = { ...key('n', { meta: true, alt: true }), key: '˜' };
    assert.equal(matchesAccelerator(optionN, 'CommandOrControl+Alt+N', 'darwin'), true);
  });
});
