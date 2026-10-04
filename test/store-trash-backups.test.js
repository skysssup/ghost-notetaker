'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../main/store');

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex')
]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 1)]);

let dir;
let file;

function openStore() {
  const store = new Store(file);
  store.load();
  return store;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-trash-'));
  file = path.join(dir, 'data.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('trash', () => {
  it('moves a note to the trash, hides it everywhere else, and restores it', () => {
    const store = openStore();
    const a = store.createNote({ title: 'Keep', content: 'one', tags: ['work'] });
    const b = store.createNote({ title: 'Drop', content: 'two', tags: ['gone'] });
    store.updateNote(b.id, { visible: true, content: 'two!' });

    const trashed = store.trashNote(b.id);
    assert.ok(trashed.trashedAt);
    assert.equal(trashed.visible, false);
    assert.deepEqual(store.listNotes().map((n) => n.id), [a.id]);
    assert.deepEqual(store.listNotes({ trashed: true }).map((n) => n.id), [b.id]);
    assert.deepEqual(store.allTags(), ['work']);
    assert.ok(!store.recentNotes(8).some((n) => n.id === b.id));
    assert.equal(store.trashNote(b.id), null, 'already in the trash');

    const restored = store.restoreNote(b.id);
    assert.equal(restored.trashedAt, null);
    assert.equal(restored.content, 'two!');
    assert.equal(store.listNotes().length, 2);
    assert.equal(store.restoreNote(b.id), null, 'not in the trash any more');
  });

  it('the trash survives a restart', () => {
    const store = openStore();
    const note = store.createNote({ title: 'Later' });
    store.trashNote(note.id);
    store.flush();
    const again = openStore();
    assert.equal(again.listNotes().length, 0);
    assert.equal(again.listNotes({ trashed: true })[0].title, 'Later');
  });

  it('notes in the trash stay in the trash through export and import', () => {
    const store = openStore();
    store.createNote({ title: 'Live' });
    const gone = store.createNote({ title: 'Gone' });
    store.trashNote(gone.id);
    const payload = JSON.parse(JSON.stringify(store.exportAll()));
    const other = new Store(path.join(dir, 'other.json'));
    other.load();
    other.importAll(payload, 'replace');
    assert.deepEqual(other.listNotes().map((n) => n.title), ['Live']);
    assert.deepEqual(other.listNotes({ trashed: true }).map((n) => n.title), ['Gone']);
  });

  it('emptying the trash and the 30-day purge delete only trashed notes', () => {
    const store = openStore();
    const keep = store.createNote({ title: 'Keep' });
    const old = store.createNote({ title: 'Old' });
    const recent = store.createNote({ title: 'Recent' });
    store.trashNote(old.id);
    store.trashNote(recent.id);
    store.getNote(old.id).trashedAt = new Date(Date.now() - 31 * 864e5).toISOString();

    assert.equal(store.purgeTrash(), 1);
    assert.deepEqual(store.listNotes({ trashed: true }).map((n) => n.id), [recent.id]);
    assert.equal(store.emptyTrash(), 1);
    assert.deepEqual(store.listNotes().map((n) => n.id), [keep.id]);
    assert.equal(store.listNotes({ trashed: true }).length, 0);
  });

  it('deleting a workspace moves its notes to the trash, restorable into a remaining workspace', () => {
    const store = openStore();
    const ws = store.createWorkspace('Client');
    const note = store.createNote({ title: 'Call notes', workspaceId: ws.id });
    store.updateNote(note.id, { visible: true });
    assert.equal(store.deleteWorkspace(ws.id), true);

    const trashed = store.listNotes({ trashed: true });
    assert.equal(trashed.length, 1);
    assert.equal(trashed[0].visible, false);
    assert.ok(store.listWorkspaces().some((w) => w.id === trashed[0].workspaceId));
    const restored = store.restoreNote(note.id);
    assert.ok(store.listWorkspaces().some((w) => w.id === restored.workspaceId));
  });
});

describe('daily backups', () => {
  it('makes at most one automatic copy per day and keeps the newest ten', () => {
    const store = openStore();
    store.createNote({ title: 'Backed up' });
    store.flush();

    const day = new Date(2026, 9, 4, 9, 0, 0);
    assert.equal(store.createBackup({ now: day }), 'ghost-notetaker-2026-10-04.json');
    assert.equal(store.createBackup({ now: day }), null, 'second automatic copy on the same day');
    assert.match(store.createBackup({ now: day, force: true }), /^ghost-notetaker-2026-10-04-090000\.json$/);

    for (let i = 5; i < 20; i += 1) store.createBackup({ now: new Date(2026, 9, i, 9, 0, 0) });
    const list = store.listBackups();
    assert.equal(list.length, 10);
    for (const b of list) {
      assert.ok(b.size > 0);
      assert.ok(Date.parse(b.modifiedAt));
    }
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(store.backupDir, list[0].name)).mode & 0o777, 0o600);
    }
  });

  it('a backup can be read back and restored over the current notes', () => {
    const store = openStore();
    store.createNote({ title: 'Original', content: 'from the backup' });
    store.flush();
    const name = store.createBackup({ now: new Date(2026, 9, 4) });
    store.createNote({ title: 'Added later' });
    store.flush();

    const result = store.importAll(store.readBackup(name), 'replace');
    assert.equal(result.imported, 1);
    const notes = store.listNotes();
    assert.deepEqual(notes.map((n) => n.title), ['Original']);
    assert.equal(notes[0].visible, false);
  });

  it('refuses backup names outside the backups folder', () => {
    const store = openStore();
    for (const bad of ['../data.json', 'ghost-notetaker-2026-10-04.json/../../x', 'notes.json', '', null]) {
      assert.throws(() => store.readBackup(bad), /Unknown backup|no longer exists/);
    }
    assert.throws(() => store.readBackup('ghost-notetaker-2020-01-01.json'), /no longer exists/);
  });

  it('does not back up while the notes file is blocked or missing', () => {
    const store = new Store(file);
    store.load();
    fs.rmSync(file, { force: true });
    assert.equal(store.createBackup({ force: true }), null);
  });
});

describe('images', () => {
  it('stores only real PNG, JPEG, GIF, and WebP files under random names', () => {
    const store = openStore();
    const png = store.saveImage(PNG);
    const jpg = store.saveImage(JPG);
    assert.match(png, /^[a-f0-9]{16}\.png$/);
    assert.match(jpg, /^[a-f0-9]{16}\.jpg$/);
    assert.deepEqual(fs.readFileSync(store.imagePath(png)), PNG);
    assert.throws(() => store.saveImage(Buffer.from('<svg onload=alert(1)></svg>          ')), /Only PNG, JPEG, GIF, and WebP/);
    assert.throws(() => store.saveImage(Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)])), /at most 10 MB/);
  });

  it('only resolves well-formed image names inside the images folder', () => {
    const store = openStore();
    assert.equal(store.imagePath('../data.json'), null);
    assert.equal(store.imagePath('0123456789abcdef.svg'), null);
    assert.equal(store.imagePath('0123456789abcdef.png/../../x'), null);
    assert.equal(store.imagePath('0123456789abcdef.png'), path.join(dir, 'images', '0123456789abcdef.png'));
  });

  it('cleanup keeps images used by notes, the trash, backups, or just pasted', () => {
    const store = openStore();
    const inNote = store.saveImage(PNG);
    const inTrash = store.saveImage(PNG);
    const inBackup = store.saveImage(PNG);
    const fresh = store.saveImage(PNG);
    const orphan = store.saveImage(PNG);

    store.createNote({ title: 'A', content: `![a](ghost-image://img/${inNote})` });
    const b = store.createNote({ title: 'B', content: `![b](ghost-image://img/${inTrash})` });
    store.trashNote(b.id);
    const c = store.createNote({ title: 'C', content: `![c](ghost-image://img/${inBackup})` });
    store.flush();
    store.createBackup({ force: true });
    store.deleteNote(c.id);
    store.flush();

    const hourAgo = (Date.now() - 2 * 3600e3) / 1000;
    for (const name of [inNote, inTrash, inBackup, orphan]) fs.utimesSync(store.imagePath(name), hourAgo, hourAgo);

    assert.equal(store.collectImageGarbage(), 1);
    const left = fs.readdirSync(store.imageDir).sort();
    assert.deepEqual(left, [inNote, inTrash, inBackup, fresh].sort());
  });

  it('exports images inside the backup file and imports them on another computer', () => {
    const store = openStore();
    const name = store.saveImage(PNG);
    store.createNote({ title: 'With image', content: `![shot](ghost-image://img/${name})` });
    const payload = store.exportAll();
    assert.equal(payload.images[name], PNG.toString('base64'));

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-other-'));
    try {
      const other = new Store(path.join(otherDir, 'data.json'));
      other.load();
      other.importAll(JSON.parse(JSON.stringify(payload)), 'merge');
      assert.deepEqual(fs.readFileSync(other.imagePath(name)), PNG);
      assert.ok(other.listNotes().some((n) => n.content.includes(name)));
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it('a note exported as Markdown carries its images inside the file', () => {
    const store = openStore();
    const name = store.saveImage(PNG);
    const note = store.createNote({ title: 'Shot', content: `Before\n![shot](ghost-image://img/${name})\nAfter` });
    const md = store.noteToMarkdown(note.id);
    assert.ok(md.includes(`![shot](data:image/png;base64,${PNG.toString('base64')})`));
    assert.ok(!md.includes('ghost-image://'));
  });

  it('rejects a backup whose image is not what its name says', () => {
    const store = openStore();
    const payload = {
      notes: [{ id: 'n1', title: 'x', content: '![](ghost-image://img/0123456789abcdef.png)' }],
      images: { '0123456789abcdef.png': JPG.toString('base64') }
    };
    assert.throws(() => store.importAll(payload, 'merge'), /Invalid image in backup/);
    assert.equal(store.listNotes().length, 0);
    payload.images = { '../escape.png': PNG.toString('base64') };
    assert.throws(() => store.importAll(payload, 'merge'), /Invalid image in backup/);
  });
});

describe('1.5 settings and note fields', () => {
  it('keeps valid theme, layout, and formatted-view settings and repairs bad ones', () => {
    const store = openStore();
    store.updateSettings({ theme: 'dark', managerView: 'list', formattedWhenIdle: false });
    let s = store.getSettings();
    assert.equal(s.theme, 'dark');
    assert.equal(s.managerView, 'list');
    assert.equal(s.formattedWhenIdle, false);
    store.updateSettings({ theme: 'neon', managerView: 'grid' });
    s = store.getSettings();
    assert.equal(s.theme, 'dark');
    assert.equal(s.managerView, 'list');
  });

  it('stores shortcut scopes only for known shortcuts and scopes', () => {
    const store = openStore();
    store.updateSettings({ shortcutScopes: { newNote: 'app', quickCapture: 'everywhere', bogus: 'app' } });
    assert.deepEqual(store.getSettings().shortcutScopes, { newNote: 'app' });
  });

  it('remembers a collapsed note across restarts', () => {
    const store = openStore();
    const note = store.createNote({ title: 'Bubble' });
    store.updateNote(note.id, { collapsed: true });
    store.flush();
    assert.equal(openStore().getNote(note.id).collapsed, true);
  });
});
