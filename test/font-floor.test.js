'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../main/store');

describe('12px text floor', () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gn-font-'));
    file = path.join(dir, 'notes.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('a note saved at 10px by an older version keeps its stored size', () => {
    const seed = new Store(file);
    seed.load();
    const note = seed.createNote({ title: 'Old small note' });
    seed.flush();
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.notes.find((n) => n.id === note.id).fontSize = 10;
    fs.writeFileSync(file, JSON.stringify(raw));

    const store = new Store(file);
    store.load();
    // The store keeps 10; only the note window and its preview show it at 12.
    assert.equal(store.getNote(note.id).fontSize, 10);
    store.updateNote(note.id, { title: 'Renamed' });
    store.flush();
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(after.notes.find((n) => n.id === note.id).fontSize, 10);
  });

  it('new notes and the default size stay at 12 or more', () => {
    const store = new Store(file);
    store.load();
    assert.equal(store.createNote({ title: 'Tiny', fontSize: 9 }).fontSize, 12);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.settings.defaultFontSize = 10;
    fs.writeFileSync(file, JSON.stringify(raw));
    const old = new Store(file);
    old.load();
    assert.equal(old.getSettings().defaultFontSize, 10);
    assert.equal(old.createNote({ title: 'From default' }).fontSize, 12);
  });

  it('sizes under 12 or over 28 are clamped on update and in settings', () => {
    const store = new Store(file);
    store.load();
    const note = store.createNote({ title: 'Sized' });
    assert.equal(store.updateNote(note.id, { fontSize: 11 }).fontSize, 12);
    assert.equal(store.updateNote(note.id, { fontSize: 40 }).fontSize, 28);
    store.updateSettings({ defaultFontSize: 10 });
    assert.equal(store.getSettings().defaultFontSize, 12);
  });
});
