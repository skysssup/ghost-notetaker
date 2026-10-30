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
  normalizeBounds,
  sortNotes,
  defaultSettings,
  STORE_VERSION
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
    assert.ok(NOTE_COLORS.length >= 10);
    assert.ok(TEMPLATES.meeting.content.includes('Agenda'));
    assert.ok(TEMPLATES.todo.content.includes('- [ ]'));
    assert.ok(TEMPLATES.daily);
    assert.ok(TEMPLATES.decision);
  });

  it('sortNotes supports multiple keys', () => {
    const notes = [
      { id: 'a', title: 'B', color: 'rose', createdAt: '2020-01-01', updatedAt: '2020-01-02' },
      { id: 'b', title: 'A', color: 'mint', createdAt: '2021-01-01', updatedAt: '2021-01-02' }
    ];
    assert.equal(sortNotes(notes, 'title')[0].id, 'b');
    assert.equal(sortNotes(notes, 'color')[0].id, 'b');
    assert.equal(sortNotes(notes, 'created')[0].id, 'b');
    assert.equal(sortNotes(notes, 'updated')[0].id, 'b');
  });
});

describe('migrate', () => {
  it('builds empty state from null', () => {
    const s = migrate(null);
    assert.equal(s.workspaces.length, 1);
    assert.equal(s.notes.length, 0);
    assert.ok(s.activeWorkspaceId);
    assert.equal(s.settings.contentProtection, true);
    assert.equal(s.version, STORE_VERSION);
  });

  it('keeps notes linked to known workspaces and upgrades settings', () => {
    const s = migrate({
      workspaces: [{ id: 'ws_a', name: 'A' }],
      activeWorkspaceId: 'ws_a',
      notes: [{ id: 'n1', workspaceId: 'ws_a', title: 'Hi', content: 'x' }],
      settings: { globalClickThrough: true }
    });
    assert.equal(s.notes.length, 1);
    assert.equal(s.notes[0].title, 'Hi');
    assert.equal(s.activeWorkspaceId, 'ws_a');
    assert.equal(s.settings.globalClickThrough, true);
    assert.equal(s.settings.contentProtection, true);
    assert.ok(s.settings.shortcuts.newNote);
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

  it('applies default opacity/color/font from settings', () => {
    const store = new Store(file);
    store.load();
    store.updateSettings({ defaultOpacity: 0.5, defaultColor: 'rose', defaultFontSize: 18 });
    const note = store.createNote({ title: 'Styled' });
    assert.equal(note.opacity, 0.5);
    assert.equal(note.color, 'rose');
    assert.equal(note.fontSize, 18);
  });

  it('filters by workspace, tag, query, and visibility', () => {
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
    store.hideNote(a.id);
    assert.equal(store.listNotes({ workspaceId: store.getActiveWorkspaceId() }).length, 1);
    assert.equal(store.listNotes({ tag: 'demo' })[0].id, a.id);
    assert.equal(store.listNotes({ query: 'hello' })[0].id, a.id);
    assert.equal(store.listNotes({ visible: false })[0].id, a.id);
    assert.equal(store.listNotes({ visible: true }).find((n) => n.id === a.id), undefined);
    assert.ok(store.allTags().includes('demo'));
    assert.ok(store.getNote(b.id));
  });

  it('tracks recent notes', () => {
    const store = new Store(file);
    store.load();
    const a = store.createNote({ title: 'First' });
    const b = store.createNote({ title: 'Second' });
    store.updateNote(a.id, { content: 'touched' });
    const recent = store.recentNotes();
    assert.equal(recent[0].id, a.id);
    assert.ok(recent.some((n) => n.id === b.id));
  });

  it('bulkSetVisible toggles many notes', () => {
    const store = new Store(file);
    store.load();
    const a = store.createNote({ title: 'A' });
    const b = store.createNote({ title: 'B' });
    const count = store.bulkSetVisible([a.id, b.id], false);
    assert.equal(count, 2);
    assert.equal(store.getNote(a.id).visible, false);
    assert.equal(store.getNote(b.id).visible, false);
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
    assert.equal(n.opacity, 1);
    assert.ok(n.bounds.width >= 200);
  });

  it('emptyState has settings shortcuts and defaults', () => {
    const s = emptyState();
    assert.ok(s.settings.shortcuts.newNote);
    assert.equal(s.settings.contentProtection, true);
    assert.deepEqual(defaultSettings().recentNoteIds, []);
  });

  it('moves notes between workspaces', () => {
    const store = new Store(file);
    store.load();
    const ws2 = store.createWorkspace('Work');
    const note = store.createNote({ title: 'Move me' });
    store.updateNote(note.id, { workspaceId: ws2.id });
    assert.equal(store.getNote(note.id).workspaceId, ws2.id);
    assert.equal(store.listNotes({ workspaceId: ws2.id }).length, 1);
  });

  it('rejects unknown workspaceId and color', () => {
    const store = new Store(file);
    store.load();
    const note = store.createNote({ title: 'Keep me', color: 'mist' });
    const beforeWs = note.workspaceId;
    store.updateNote(note.id, { workspaceId: 'ws_missing', color: 'neon-green' });
    const after = store.getNote(note.id);
    assert.equal(after.workspaceId, beforeWs);
    assert.equal(after.color, 'mist');
    const ws2 = store.createWorkspace('Work');
    store.updateNote(note.id, { workspaceId: ws2.id, color: 'rose' });
    assert.equal(store.getNote(note.id).workspaceId, ws2.id);
    assert.equal(store.getNote(note.id).color, 'rose');
  });

});

describe('tag normalize + size caps', () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-tags-'));
    store = new Store(path.join(dir, 'data.json'));
    store.load();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('normalizes tags to lowercase and dedupes', () => {
    const note = store.createNote({ title: 'T', tags: ['Demo', 'demo', ' #Work ', '', 'Demo'] });
    assert.deepEqual(note.tags, ['demo', 'work']);
    store.updateNote(note.id, { tags: ['ALPHA', 'alpha', 'Beta'] });
    assert.deepEqual(store.getNote(note.id).tags, ['alpha', 'beta']);
  });

  it('allTags returns lowercase unique chips', () => {
    store.createNote({ title: 'A', tags: ['Demo'] });
    store.createNote({ title: 'B', tags: ['demo', 'Other'] });
    assert.deepEqual(store.allTags(), ['demo', 'other']);
  });

  it('clamps title and content length', () => {
    const { TITLE_MAX, CONTENT_MAX } = require('../main/store');
    const note = store.createNote({
      title: 'x'.repeat(TITLE_MAX + 50),
      content: 'y'.repeat(CONTENT_MAX + 10)
    });
    assert.equal(note.title.length, TITLE_MAX);
    assert.equal(note.content.length, CONTENT_MAX);
  });
});

describe('untitled notes take their first line as title', () => {
  const { deriveTitle, DERIVED_TITLE_MAX } = require('../main/store');
  let dir;
  let file;
  let stores = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-title-'));
    file = path.join(dir, 'data.json');
    stores = [];
  });

  afterEach(() => {
    // Write pending saves now, so a deferred save cannot recreate the removed dir.
    for (const store of stores) store.flush();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function openStore(at = file) {
    const store = new Store(at);
    store.load();
    stores.push(store);
    return store;
  }

  it('uses the first line with words in it, without Markdown markers', () => {
    assert.equal(deriveTitle('Groceries\n- [ ] milk'), 'Groceries');
    assert.equal(deriveTitle('\n\n  # Plan for **Monday** ##\nmore'), 'Plan for Monday');
    assert.equal(deriveTitle('- [x] Buy *milk* and `eggs`'), 'Buy milk and eggs');
    assert.equal(deriveTitle('> see [the doc](https://example.com) first'), 'see the doc first');
    assert.equal(deriveTitle('1. First step'), 'First step');
    assert.equal(deriveTitle('~~old~~ new <b>plan</b>'), 'old new plan');
    assert.equal(deriveTitle('snake_case_name stays'), 'snake_case_name stays');
    assert.equal(deriveTitle('#hashtag is not a heading'), '#hashtag is not a heading');
  });

  it('skips lines without words: blanks, rules, fences, bare images, comments', () => {
    assert.equal(deriveTitle('---\n\n```js\nconst a = 1\n```'), 'const a = 1');
    assert.equal(deriveTitle('![](ghost-image://img/0123456789abcdef.png)\nCaption'), 'Caption');
    assert.equal(deriveTitle('<!-- draft -->\n#\n- \nReal line'), 'Real line');
    assert.equal(deriveTitle('   \n\t\n'), '');
    assert.equal(deriveTitle(''), '');
  });

  it('cuts long lines at a word and ends them with an ellipsis', () => {
    const long = 'Ein sehr langer Satz der viel länger ist als sechzig Zeichen und deshalb gekürzt wird';
    const title = deriveTitle(long);
    assert.ok(Array.from(title).length <= DERIVED_TITLE_MAX, title);
    assert.ok(title.endsWith('…'));
    assert.ok(long.startsWith(title.slice(0, -1)));
    assert.ok(!/\s…$/.test(title));
    const noSpaces = 'x'.repeat(200);
    assert.equal(Array.from(deriveTitle(noSpaces)).length, DERIVED_TITLE_MAX);
  });

  it('a new blank note follows its text as it is typed', () => {
    const store = openStore();
    const note = store.createNote();
    assert.equal(note.title, 'Untitled');
    assert.equal(note.autoTitle, true);
    store.updateNote(note.id, { content: 'Groceries\n- [ ] milk' });
    assert.equal(store.getNote(note.id).title, 'Groceries');
    store.updateNote(note.id, { content: '## Weekend groceries\n- [ ] milk' });
    assert.equal(store.getNote(note.id).title, 'Weekend groceries');
    store.updateNote(note.id, { content: '' });
    assert.equal(store.getNote(note.id).title, 'Untitled');
  });

  it('a title the person typed always wins, and clearing it hands the title back to the text', () => {
    const store = openStore();
    const note = store.createNote({ content: 'Groceries' });
    assert.equal(note.title, 'Groceries');
    store.updateNote(note.id, { title: 'Shopping' });
    store.updateNote(note.id, { content: 'Something else entirely' });
    assert.equal(store.getNote(note.id).title, 'Shopping');
    assert.equal(store.getNote(note.id).autoTitle, false);
    store.updateNote(note.id, { title: '   ' });
    assert.equal(store.getNote(note.id).title, 'Something else entirely');
    assert.equal(store.getNote(note.id).autoTitle, true);
    const named = store.createNote({ title: 'Named', content: 'First line' });
    assert.equal(named.title, 'Named');
    assert.equal(named.autoTitle, false);
    const meeting = store.createNote({ templateId: 'meeting' });
    assert.equal(meeting.title, 'Meeting notes');
    assert.equal(meeting.autoTitle, false);
  });

  it('a title typed as "Untitled" is a real title and is never replaced', () => {
    const store = openStore();
    const typed = store.createNote({ title: 'Untitled', content: 'First line' });
    assert.equal(typed.title, 'Untitled');
    assert.equal(typed.autoTitle, false);
    const later = store.createNote({ content: 'Groceries' });
    store.updateNote(later.id, { title: 'Untitled' });
    store.updateNote(later.id, { content: 'Groceries\n- milk' });
    assert.equal(store.getNote(later.id).title, 'Untitled');
    assert.equal(store.getNote(later.id).autoTitle, false);
    store.updateNote(later.id, { title: '' });
    assert.equal(store.getNote(later.id).title, 'Groceries');
    assert.equal(store.getNote(later.id).autoTitle, true);
  });

  it('moving or styling a note does not change a typed title', () => {
    const store = openStore();
    const note = store.createNote({ title: 'Keep me', content: 'Body' });
    store.updateNote(note.id, { color: NOTE_COLORS[1].id, bounds: { x: 1, y: 2, width: 300, height: 300 } });
    assert.equal(store.getNote(note.id).title, 'Keep me');
  });

  it('migrates notes saved before derived titles: only empty or blank titles take their first line', () => {
    const state = migrate({
      notes: [
        { id: 'a', title: 'Untitled', content: '# Trip ideas\n- Lisbon' },
        { id: 'b', title: '', content: 'Call the plumber' },
        { id: 'c', title: 'Budget', content: 'Rent\nFood' },
        { id: 'd', title: 'Untitled', content: '' },
        { id: 'e', title: '   ', content: '- [ ] Book flights' },
        { id: 'f', content: 'No title field at all' }
      ]
    });
    const byId = Object.fromEntries(state.notes.map((n) => [n.id, n]));
    // A stored "Untitled" may be a title someone typed, so it is kept.
    assert.equal(byId.a.title, 'Untitled');
    assert.equal(byId.a.autoTitle, false);
    assert.equal(byId.d.title, 'Untitled');
    assert.equal(byId.d.autoTitle, false);
    assert.equal(byId.b.title, 'Call the plumber');
    assert.equal(byId.b.autoTitle, true);
    assert.equal(byId.c.title, 'Budget');
    assert.equal(byId.c.autoTitle, false);
    assert.equal(byId.e.title, 'Book flights');
    assert.equal(byId.e.autoTitle, true);
    assert.equal(byId.f.title, 'No title field at all');
    assert.equal(byId.f.autoTitle, true);
    // Loading the migrated state again changes nothing.
    const again = migrate(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(
      again.notes.map((n) => [n.id, n.title, n.autoTitle]),
      state.notes.map((n) => [n.id, n.title, n.autoTitle])
    );
  });

  it('a stored "Untitled" note keeps its title across a reload and later edits', () => {
    fs.writeFileSync(
      file,
      // A store at the current version (older ones are upgraded once on load).
      JSON.stringify({ version: STORE_VERSION, notes: [{ id: 'old', title: 'Untitled', content: 'Shopping list' }] })
    );
    const store = openStore();
    assert.equal(store.getNote('old').title, 'Untitled');
    store.updateNote('old', { content: 'Something new' });
    assert.equal(store.getNote('old').title, 'Untitled');
  });

  it('keeps the derived/typed choice across a save and reload', () => {
    const store = openStore();
    const auto = store.createNote({ content: 'Auto line' });
    const typed = store.createNote({ title: 'Typed', content: 'Body' });
    store.flush();
    const again = openStore();
    assert.equal(again.getNote(auto.id).autoTitle, true);
    assert.equal(again.getNote(auto.id).title, 'Auto line');
    again.updateNote(auto.id, { content: 'Changed line' });
    assert.equal(again.getNote(auto.id).title, 'Changed line');
    assert.equal(again.getNote(typed.id).autoTitle, false);
  });

  it('search, title sorting, and export see the derived title', () => {
    const store = openStore();
    const note = store.createNote({ content: 'Zebra crossing\nnotes' });
    store.createNote({ title: 'Apple', content: 'x' });
    assert.deepEqual(store.listNotes({ query: 'zebra' }).map((n) => n.id), [note.id]);
    assert.deepEqual(
      store.listNotes({ sortBy: 'title' }).map((n) => n.title).filter((t) => t === 'Apple' || t === 'Zebra crossing'),
      ['Apple', 'Zebra crossing']
    );
    // The text already starts with the title, so the export does not add a heading.
    assert.equal(store.noteToMarkdown(note.id), 'Zebra crossing\nnotes\n');
    const empty = store.createNote();
    assert.match(store.noteToMarkdown(empty.id), /^# Untitled/);
  });

  it('a backup restores derived and typed titles as they were', () => {
    const store = openStore();
    store.createNote({ content: 'From text' });
    store.createNote({ title: 'Untouched', content: 'From text' });
    const payload = JSON.parse(JSON.stringify(store.exportAll()));
    const other = openStore(path.join(dir, 'other.json'));
    other.importAll(payload, 'replace');
    const titles = other.listNotes().map((n) => [n.title, n.autoTitle]).sort();
    assert.deepEqual(titles.filter(([t]) => t === 'From text' || t === 'Untouched'), [
      ['From text', true],
      ['Untouched', false]
    ]);
  });
});

describe('tag drafts are kept with the note', () => {
  const { TAG_DRAFT_MAX } = require('../main/store');
  const { sanitizeNotePatch } = require('../main/ipc-guards');
  let dir;
  let file;
  let stores = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-tagdraft-'));
    file = path.join(dir, 'data.json');
    stores = [];
  });

  afterEach(() => {
    for (const store of stores) store.flush();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function openStore() {
    const store = new Store(file);
    store.load();
    stores.push(store);
    return store;
  }

  it('saves the unfinished tag and restores it after a reload, without adding a tag', () => {
    const store = openStore();
    const note = store.createNote({ title: 'Trip', content: 'Lisbon', tags: ['travel'] });
    assert.equal(note.tagDraft, '');
    store.updateNote(note.id, { tagDraft: 'portug' });
    store.flush();
    const again = openStore();
    assert.equal(again.getNote(note.id).tagDraft, 'portug');
    assert.deepEqual(again.getNote(note.id).tags, ['travel']);
    again.updateNote(note.id, { tags: ['travel', 'portugal'], tagDraft: '' });
    assert.equal(again.getNote(note.id).tagDraft, '');
  });

  it('is not an edit, and search and Markdown export ignore it', () => {
    const store = openStore();
    const note = store.createNote({ title: 'Trip', content: 'Lisbon' });
    const editedAt = store.getNote(note.id).updatedAt;
    store.updateNote(note.id, { tagDraft: 'zanzibar' });
    assert.equal(store.getNote(note.id).updatedAt, editedAt);
    assert.deepEqual(store.listNotes({ query: 'zanzibar' }), []);
    assert.ok(!store.noteToMarkdown(note.id).includes('zanzibar'));
    assert.equal(store.duplicateNote(note.id).tagDraft, '');
  });

  it('is a short single line, from the store and from the window alike', () => {
    const store = openStore();
    const note = store.createNote();
    store.updateNote(note.id, { tagDraft: `a\nb${'x'.repeat(100)}` });
    const draft = store.getNote(note.id).tagDraft;
    assert.equal(draft.length, TAG_DRAFT_MAX);
    assert.ok(draft.startsWith('a b'));
    store.updateNote(note.id, { tagDraft: 42 });
    assert.equal(store.getNote(note.id).tagDraft, '');
    assert.equal(sanitizeNotePatch({ tagDraft: 'y'.repeat(100) }).tagDraft.length, TAG_DRAFT_MAX);
    assert.equal(migrate({ notes: [{ id: 'old', title: 'Old', content: '' }] }).notes[0].tagDraft, '');
  });
});

describe('one-time upgrade: stored "Untitled" titles follow their first line', () => {
  let dir;
  let file;
  let stores = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-upgrade-'));
    file = path.join(dir, 'data.json');
    stores = [];
  });

  afterEach(() => {
    for (const store of stores) {
      try {
        store.flush();
      } catch (_) {
        // a test may leave the store unable to save
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function openStore() {
    const store = new Store(file);
    store.load();
    stores.push(store);
    return store;
  }

  const oldNotes = () => [
    { id: 'a', title: 'Untitled', content: '# Trip ideas\n- Lisbon' },
    { id: 'b', title: 'Untitled', content: '' },
    { id: 'c', title: 'Budget', content: 'Rent' },
    { id: 'd', title: 'Untitled ', content: 'Not exactly the default' },
    { id: 'e', title: 'Untitled', autoTitle: false, content: 'Flag from a dev build' }
  ];
  const onDisk = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const titles = (notes) => Object.fromEntries(notes.map((n) => [n.id, [n.title, n.autoTitle]]));

  it('an old store has its "Untitled" titles cleared and its version bumped on disk', () => {
    assert.ok(STORE_VERSION >= 3);
    fs.writeFileSync(file, JSON.stringify({ version: 2, notes: oldNotes() }));
    const store = openStore();
    assert.deepEqual(titles(store.listNotes()), {
      a: ['Trip ideas', true],
      b: ['Untitled', true],
      c: ['Budget', false],
      d: ['Untitled ', false],
      e: ['Flag from a dev build', true]
    });
    // Persisted right away, without waiting for an edit.
    const saved = onDisk();
    assert.equal(saved.version, STORE_VERSION);
    assert.deepEqual(titles(saved.notes), titles(store.listNotes()));
    // An empty upgraded note follows its text once it gets some.
    store.updateNote('b', { content: 'Later text' });
    assert.equal(store.getNote('b').title, 'Later text');
  });

  it('a store without a version counts as old', () => {
    fs.writeFileSync(file, JSON.stringify({ notes: [{ id: 'x', title: 'Untitled', content: 'Call mum' }] }));
    const store = openStore();
    assert.equal(store.getNote('x').title, 'Call mum');
    assert.equal(onDisk().version, STORE_VERSION);
  });

  it('runs only once: the second load changes nothing, and "Untitled" typed after it is kept', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 2, notes: oldNotes() }));
    const first = openStore();
    first.updateNote('c', { title: 'Untitled' });
    first.flush();
    const before = fs.readFileSync(file, 'utf8');
    const second = openStore();
    assert.equal(second.getNote('c').title, 'Untitled');
    assert.equal(second.getNote('c').autoTitle, false);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'a current store is not rewritten on load');
  });

  it('a store already at the new version keeps "Untitled" titles', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: STORE_VERSION,
        notes: [
          { id: 'k', title: 'Untitled', autoTitle: false, content: 'Typed on purpose' },
          { id: 'n', title: 'Untitled', content: 'No flag' }
        ]
      })
    );
    const store = openStore();
    assert.equal(store.getNote('k').title, 'Untitled');
    assert.equal(store.getNote('n').title, 'Untitled');
  });

  it('if saving the upgrade fails, the file is untouched and the next load reruns it safely', () => {
    const original = JSON.stringify({ version: 2, notes: oldNotes() });
    fs.writeFileSync(file, original);
    const rename = fs.renameSync;
    fs.renameSync = () => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    };
    let failed;
    try {
      failed = new Store(file);
      failed.load(); // must not throw; the upgrade is kept in memory and retried later
    } finally {
      fs.renameSync = rename;
    }
    assert.equal(failed.getNote('a').title, 'Trip ideas');
    assert.equal(fs.readFileSync(file, 'utf8'), original, 'the old file is still there, whole');
    assert.deepEqual(fs.readdirSync(dir), ['data.json'], 'no temp file left behind');
    // Like a crash before the retry: drop that store and load again.
    clearTimeout(failed._saveTimer);
    const again = openStore();
    assert.deepEqual(titles(again.listNotes()), titles(failed.listNotes()));
    assert.equal(onDisk().version, STORE_VERSION);
    assert.equal(onDisk().notes.find((n) => n.id === 'a').title, 'Trip ideas');
  });

  describe('importing a backup runs the same upgrade', () => {
    const imported = (store) => Object.fromEntries(store.listNotes().map((n) => [n.content, [n.title, n.autoTitle]]));

    it('an old (version 2) backup has its "Untitled" titles cleared on import', () => {
      const store = openStore();
      store.importAll({ version: 2, notes: oldNotes() }, 'merge');
      const got = imported(store);
      assert.deepEqual(got['# Trip ideas\n- Lisbon'], ['Trip ideas', true]);
      assert.deepEqual(got[''], ['Untitled', true]);
      assert.deepEqual(got['Rent'], ['Budget', false]);
      assert.deepEqual(got['Not exactly the default'], ['Untitled ', false]);
      assert.deepEqual(got['Flag from a dev build'], ['Flag from a dev build', true]);
    });

    it('a backup without a version counts as old (replace mode too)', () => {
      const store = openStore();
      store.importAll({ notes: [{ id: 'x', title: 'Untitled', content: 'Call mum' }] }, 'replace');
      assert.equal(store.getNote('x').title, 'Call mum');
      assert.equal(store.getNote('x').autoTitle, true);
    });

    it('a current-version backup is left alone: "Untitled" stays', () => {
      const store = openStore();
      store.importAll(
        {
          version: STORE_VERSION,
          notes: [
            { id: 'k', title: 'Untitled', autoTitle: false, content: 'Typed on purpose' },
            { id: 'n', title: 'Untitled', content: 'No flag' }
          ]
        },
        'merge'
      );
      assert.deepEqual(imported(store)['Typed on purpose'], ['Untitled', false]);
      assert.deepEqual(imported(store)['No flag'], ['Untitled', false]);
    });

    it('the payload passed in is not modified', () => {
      const payload = { version: 2, notes: oldNotes() };
      const copy = structuredClone(payload);
      openStore().importAll(payload, 'merge');
      assert.deepEqual(payload, copy);
    });
  });

  it('a failed upgrade save is retried in the same session', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 2, notes: oldNotes() }));
    const rename = fs.renameSync;
    let calls = 0;
    fs.renameSync = (...args) => {
      calls += 1;
      if (calls === 1) throw new Error('busy');
      return rename(...args);
    };
    let store;
    try {
      store = openStore();
      assert.equal(onDisk().version, 2);
      store.flush(); // what the retry timer does
    } finally {
      fs.renameSync = rename;
    }
    assert.equal(onDisk().version, STORE_VERSION);
    assert.equal(onDisk().notes.find((n) => n.id === 'a').title, 'Trip ideas');
  });
});
