'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  Store,
  migrate,
  emptyState,
  createNoteRecord,
  NOTE_COLORS,
  TEMPLATES,
  clamp,
  normalizeBounds
} = require('../main/store');

describe('store helpers', () => {
  it('clamps numbers', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(99, 0, 10), 10);
    assert.equal(clamp(Number.NaN, 0, 10), 0);
  });

  it('normalizes bounds with minimums', () => {
    const b = normalizeBounds({ x: 1.2, y: 3.8, width: 10, height: 10 });
    assert.equal(b.width, 200);
    assert.equal(b.height, 160);
    assert.equal(b.x, 1);
    assert.equal(b.y, 4);
  });

  it('exposes colors and templates', () => {
    assert.ok(NOTE_COLORS.length >= 4);
    assert.ok(TEMPLATES.meeting.content.includes('Agenda'));
    assert.ok(TEMPLATES.todo.content.includes('- [ ]'));
  });
});

describe('migrate', () => {
  it('builds empty state from null', () => {
    const s = migrate(null);
    assert.equal(s.workspaces.length, 1);
    assert.equal(s.notes.length, 0);
    assert.ok(s.activeWorkspaceId);
  });

  it('keeps notes linked to known workspaces', () => {
    const s = migrate({
      workspaces: [{ id: 'ws_a', name: 'A' }],
      activeWorkspaceId: 'ws_a',
      notes: [{ id: 'n1', workspaceId: 'ws_a', title: 'Hi', content: 'x' }]
    });
    assert.equal(s.notes.length, 1);
    assert.equal(s.notes[0].title, 'Hi');
    assert.equal(s.activeWorkspaceId, 'ws_a');
  });
});

describe('Store persistence', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-nt-'));
    file = path.join(dir, 'data.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates default file on load', () => {
    const store = new Store(file);
    store.load();
    assert.ok(fs.existsSync(file));
    assert.equal(store.listWorkspaces().length, 1);
  });

  it('creates notes with templates and updates timestamps', () => {
    const store = new Store(file);
    store.load();
    const note = store.createNote({ templateId: 'meeting' });
    assert.match(note.content, /Agenda/);
    assert.equal(note.visible, true);
    const before = note.updatedAt;
    const updated = store.updateNote(note.id, { title: 'Standup' });
    assert.equal(updated.title, 'Standup');
    assert.ok(updated.updatedAt >= before);
  });

  it('filters by workspace, tag, and query', () => {
    const store = new Store(file);
    store.load();
    const ws2 = store.createWorkspace('Work');
    const a = store.createNote({ title: 'Alpha', content: 'hello world', tags: ['demo'] });
    const b = store.createNote({
      title: 'Beta',
      content: 'other',
      tags: ['work'],
      workspaceId: ws2.id
    });
    assert.equal(store.listNotes({ workspaceId: store.getActiveWorkspaceId() }).length, 1);
    assert.equal(store.listNotes({ tag: 'demo' })[0].id, a.id);
    assert.equal(store.listNotes({ query: 'hello' })[0].id, a.id);
    assert.ok(store.allTags().includes('demo'));
    assert.ok(store.getNote(b.id));
  });

  it('hide does not delete; delete removes', () => {
    const store = new Store(file);
    store.load();
    const note = store.createNote({ title: 'Temp' });
    store.hideNote(note.id);
    assert.equal(store.getNote(note.id).visible, false);
    assert.equal(store.deleteNote(note.id), true);
    assert.equal(store.getNote(note.id), null);
  });

  it('export / import merge and replace', () => {
    const store = new Store(file);
    store.load();
    store.createNote({ title: 'One', content: 'a' });
    const payload = store.exportAll();
    assert.equal(payload.notes.length, 1);

    const store2 = new Store(path.join(dir, 'other.json'));
    store2.load();
    store2.createNote({ title: 'Existing' });
    const merged = store2.importAll(payload, 'merge');
    assert.equal(merged.mode, 'merge');
    assert.ok(store2.listNotes().length >= 2);

    const store3 = new Store(path.join(dir, 'replace.json'));
    store3.load();
    store3.createNote({ title: 'WillGo' });
    store3.importAll(payload, 'replace');
    assert.equal(store3.listNotes().length, 1);
    assert.equal(store3.listNotes()[0].title, 'One');
  });

  it('noteToMarkdown includes title and tags', () => {
    const store = new Store(file);
    store.load();
    const note = store.createNote({ title: 'Doc', content: 'Body', tags: ['x', 'y'] });
    const md = store.noteToMarkdown(note.id);
    assert.match(md, /^# Doc/);
    assert.match(md, /tags: x, y/);
  });

  it('refuses deleting the last workspace', () => {
    const store = new Store(file);
    store.load();
    const id = store.getActiveWorkspaceId();
    assert.equal(store.deleteWorkspace(id), false);
  });

  it('persists across reload', () => {
    const store = new Store(file);
    store.load();
    const note = store.createNote({ title: 'Persist me', content: 'data' });
    store.flush();
    const store2 = new Store(file);
    store2.load();
    assert.equal(store2.getNote(note.id).content, 'data');
  });


  it('duplicates a note with offset bounds', () => {
    const store = new Store(file);
    store.load();
    const note = store.createNote({ title: 'Orig', content: 'body', tags: ['a'] });
    const copy = store.duplicateNote(note.id);
    assert.ok(copy);
    assert.notEqual(copy.id, note.id);
    assert.match(copy.title, /\(copy\)/);
    assert.equal(copy.content, 'body');
    assert.deepEqual(copy.tags, ['a']);
    assert.equal(copy.bounds.x, note.bounds.x + 28);
  });

  it('createNoteRecord defaults', () => {
    const n = createNoteRecord({ workspaceId: 'ws' });
    assert.equal(n.pinned, true);
    assert.equal(n.opacity, 0.88);
    assert.ok(n.bounds.width >= 200);
  });

  it('emptyState has settings shortcuts', () => {
    const s = emptyState();
    assert.ok(s.settings.shortcuts.newNote);
  });
});
