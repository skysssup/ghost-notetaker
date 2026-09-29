'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { matchesAccelerator, SHORTCUT_ACTIONS } = require('../main/accelerator');
const { TEMPLATES, defaultShortcuts } = require('../main/store');

describe('shortcuts helpers', () => {
  it('lists expected actions', () => {
    const ids = SHORTCUT_ACTIONS.map((a) => a.id);
    assert.ok(ids.includes('newNote'));
    assert.ok(ids.includes('toggleManager'));
    assert.ok(ids.includes('recoveryNewNote'));
    assert.ok(ids.includes('togglePreview'));
  });

  it('matches CommandOrControl+Shift+N style input', () => {
    const input = {
      type: 'keyDown',
      key: 'n',
      code: 'KeyN',
      control: process.platform !== 'darwin',
      meta: process.platform === 'darwin',
      alt: false,
      shift: true
    };
    assert.equal(matchesAccelerator(input, 'CommandOrControl+Shift+N'), true);
  });

  it('rejects when shift missing', () => {
    const input = {
      type: 'keyDown',
      key: 'n',
      code: 'KeyN',
      control: true,
      meta: false,
      alt: false,
      shift: false
    };
    assert.equal(matchesAccelerator(input, 'CommandOrControl+Shift+N'), false);
  });

  it('defaultShortcuts cover every action id', () => {
    const defs = defaultShortcuts();
    for (const a of SHORTCUT_ACTIONS) {
      assert.ok(defs[a.id], `missing default for ${a.id}`);
    }
  });
});

describe('templates', () => {
  it('every template has id, label, title, content', () => {
    for (const t of Object.values(TEMPLATES)) {
      assert.ok(t.id);
      assert.ok(t.label);
      assert.ok(typeof t.title === 'string');
      assert.ok(typeof t.content === 'string');
    }
  });

  it('meeting and todo templates are usable', () => {
    assert.match(TEMPLATES.meeting.content, /Agenda/);
    assert.match(TEMPLATES.todo.content, /- \[ \]/);
    assert.ok(TEMPLATES.scratch);
  });
});
