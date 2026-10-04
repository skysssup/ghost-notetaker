'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, migrate } = require('../main/store');

describe('edited time and recent list', () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-edits-'));
    store = new Store(path.join(dir, 'data.json'));
    store.load();
  });

  afterEach(() => {
    if (store._saveTimer) clearTimeout(store._saveTimer);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('moving, hiding, or restyling a note does not change when it was edited', () => {
    const note = store.createNote({ title: 'Stable' });
    note.updatedAt = '2020-01-01T00:00:00.000Z';
    store.updateNote(note.id, {
      bounds: { x: 10, y: 20, width: 400, height: 300 },
      visible: false,
      opacity: 0.5,
      pinned: false,
      previewMode: true,
      color: 'rose'
    });
    assert.equal(store.getNote(note.id).updatedAt, '2020-01-01T00:00:00.000Z');
    assert.equal(store.getNote(note.id).bounds.width, 400);
  });

  it('changing text updates the edited time and the recent list; re-saving the same text does not', () => {
    const a = store.createNote({ title: 'A', content: 'one' });
    store.createNote({ title: 'B' });
    a.updatedAt = '2020-01-01T00:00:00.000Z';
    store.updateNote(a.id, { content: 'one' });
    assert.equal(store.getNote(a.id).updatedAt, '2020-01-01T00:00:00.000Z');
    assert.notEqual(store.recentNotes()[0].id, a.id);
    store.updateNote(a.id, { content: 'two' });
    assert.notEqual(store.getNote(a.id).updatedAt, '2020-01-01T00:00:00.000Z');
    assert.equal(store.recentNotes()[0].id, a.id);
  });

  it('unknown colors from old files or backups fall back to a real palette color', () => {
    const state = migrate({ notes: [{ id: 'n1', title: 'x', color: 'neon' }], settings: { defaultColor: 'rose' } });
    assert.equal(state.notes[0].color, 'rose');
  });
});

describe('loading the notes file', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-load-'));
    file = path.join(dir, 'data.json');
  });

  afterEach(() => {
    fs.chmodSync(dir, 0o700);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a file that cannot be read is reported, not quarantined as corrupt', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
    fs.writeFileSync(file, JSON.stringify({ notes: [] }));
    fs.chmodSync(file, 0o000);
    const store = new Store(file);
    assert.throws(() => store.load(), /EACCES/);
    fs.chmodSync(file, 0o600);
    assert.deepEqual(fs.readdirSync(dir), ['data.json']);
  });

  it('a missing file in an unwritable folder is reported instead of silently blocking saves', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
    fs.chmodSync(dir, 0o500);
    const store = new Store(file);
    assert.throws(() => store.load(), /EACCES/);
    assert.equal(store.getLoadError(), null);
  });

  it('keeps a copy of a corrupt file that could not be moved aside before recovering', () => {
    fs.writeFileSync(file, '{oops');
    const rename = fs.renameSync;
    fs.renameSync = () => {
      throw new Error('simulated rename failure');
    };
    let store;
    try {
      store = new Store(file);
      store.load();
    } finally {
      fs.renameSync = rename;
    }
    assert.equal(store.getLoadError().quarantinePath, null);
    store.acknowledgeCorruptRecovery();
    const copies = fs.readdirSync(dir).filter((f) => f.includes('.corrupt.'));
    assert.equal(copies.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, copies[0]), 'utf8'), '{oops');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).notes.length, 0);
  });
});

describe('saving when the disk refuses writes', () => {
  it('keeps changes in memory, reports the failure once, and retries until it succeeds', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-retry-'));
    const file = path.join(dir, 'data.json');
    const events = [];
    const store = new Store(file, { onSaveStateChange: (state) => events.push(state) });
    try {
      store.load();
      fs.chmodSync(dir, 0o500);
      store.createNote({ title: 'Pending', content: 'kept in memory' });
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(events.length, 1);
      assert.equal(events[0].ok, false);
      assert.match(events[0].message, /EACCES/);
      assert.equal(store.isDirty(), true);

      fs.chmodSync(dir, 0o700);
      await new Promise((r) => setTimeout(r, 2400));
      assert.deepEqual(events.at(-1), { ok: true });
      assert.equal(events.length, 2);
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).notes[0].content, 'kept in memory');
    } finally {
      if (store._saveTimer) clearTimeout(store._saveTimer);
      fs.chmodSync(dir, 0o700);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
