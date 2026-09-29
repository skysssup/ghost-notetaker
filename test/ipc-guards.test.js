'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  requireId,
  sanitizeNotePatch,
  sanitizeCreateOptions,
  sanitizeSettingsPatch,
  sanitizeIdList
} = require('../main/ipc-guards');

describe('ipc guards', () => {
  it('requireId rejects empty and oversized values', () => {
    assert.equal(requireId('note_abc'), 'note_abc');
    assert.throws(() => requireId(''), /Invalid/);
    assert.throws(() => requireId(null), /Invalid/);
    assert.throws(() => requireId('x'.repeat(200)), /Invalid/);
  });

  it('sanitizeNotePatch drops unknown fields and bad colors', () => {
    const patch = sanitizeNotePatch({
      title: 'Hi',
      content: 'Body',
      color: 'neon',
      tags: ['A', 'a'],
      __proto__: { polluted: true },
      evil: 'nope',
      opacity: 9,
      monospace: 1
    });
    assert.equal(patch.title, 'Hi');
    assert.equal(patch.content, 'Body');
    assert.equal(patch.color, undefined);
    assert.deepEqual(patch.tags, ['a']);
    assert.equal(patch.opacity, 1);
    assert.equal(patch.monospace, true);
    assert.equal(patch.evil, undefined);
  });

  it('sanitizeCreateOptions keeps templateId and caps title', () => {
    const o = sanitizeCreateOptions({
      templateId: 'meeting',
      title: 'z'.repeat(500),
      hack: true
    });
    assert.equal(o.templateId, 'meeting');
    assert.equal(o.title.length, 200);
    assert.equal(o.hack, undefined);
  });

  it('sanitizeSettingsPatch only allows known keys', () => {
    const s = sanitizeSettingsPatch({
      launchAtLogin: 1,
      sortBy: 'title',
      defaultColor: 'bogus',
      shortcuts: { newNote: 'CommandOrControl+N', bogus: 'x' },
      notASetting: true
    });
    assert.equal(s.launchAtLogin, true);
    assert.equal(s.sortBy, 'title');
    assert.equal(s.defaultColor, undefined);
    assert.deepEqual(s.shortcuts, { newNote: 'CommandOrControl+N' });
    assert.equal(s.notASetting, undefined);
  });

  it('sanitizeIdList filters junk', () => {
    assert.deepEqual(sanitizeIdList(['a', '', 3, 'b']), ['a', 'b']);
  });
});
