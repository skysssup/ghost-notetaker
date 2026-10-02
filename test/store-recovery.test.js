'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../main/store');

describe('corrupt store quarantine', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-corrupt-'));
    file = path.join(dir, 'data.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('quarantines invalid JSON and blocks overwrite until recovery', () => {
    fs.writeFileSync(file, '{not-json', 'utf8');
    const store = new Store(file);
    store.load();
    assert.ok(store.getLoadError());
    assert.equal(store.isSaveBlocked(), true);
    assert.equal(fs.existsSync(file), false);
    assert.ok(store.getLoadError().quarantinePath);
    assert.ok(fs.existsSync(store.getLoadError().quarantinePath));
    assert.throws(() => store.saveSync(), /blocked/);
    assert.throws(() => store.flush(), /blocked/);
    // Original corrupt bytes preserved in quarantine
    const q = fs.readFileSync(store.getLoadError().quarantinePath, 'utf8');
    assert.equal(q, '{not-json');
    store.acknowledgeCorruptRecovery();
    assert.equal(store.isSaveBlocked(), false);
    assert.equal(store.getLoadError(), null);
    assert.ok(fs.existsSync(file));
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(parsed.notes.length, 0);
  });

  it('quarantines non-array notes field', () => {
    fs.writeFileSync(file, JSON.stringify({ notes: 'oops', workspaces: [] }), 'utf8');
    const store = new Store(file);
    store.load();
    assert.ok(store.getLoadError());
    assert.match(store.getLoadError().message, /notes must be an array/i);
    assert.equal(store.isSaveBlocked(), true);
  });
});

describe('import merge collisions + replace protection', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-import-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('preserves both notes when merge ids collide', () => {
    const store = new Store(path.join(dir, 'a.json'));
    store.load();
    const local = store.createNote({ title: 'Local', content: 'keep-me', tags: ['local'] });
    store.flush();

    const payload = {
      notes: [
        {
          id: local.id,
          workspaceId: local.workspaceId,
          title: 'Imported twin',
          content: 'incoming',
          tags: ['import']
        }
      ],
      workspaces: store.listWorkspaces()
    };
    const result = store.importAll(payload, 'merge');
    assert.equal(result.mode, 'merge');
    assert.equal(result.imported, 1);
    assert.equal(result.collisions.length, 1);
    assert.equal(result.collisions[0].importedId, local.id);
    assert.equal(store.getNote(local.id).title, 'Local');
    assert.equal(store.getNote(local.id).content, 'keep-me');
    const twin = store.getNote(result.collisions[0].newId);
    assert.ok(twin);
    assert.equal(twin.title, 'Imported twin');
    assert.equal(twin.visible, false);
  });

  it('replace keeps protection policy and hides notes', () => {
    const store = new Store(path.join(dir, 'b.json'));
    store.load();
    store.updateSettings({ contentProtection: true });
    store.createNote({ title: 'Will go' });
    const payload = {
      notes: [
        {
          id: 'note_imported',
          title: 'From backup',
          content: 'x',
          visible: true,
          workspaceId: 'ws_x'
        }
      ],
      workspaces: [{ id: 'ws_x', name: 'Backup WS' }],
      settings: { contentProtection: false },
      activeWorkspaceId: 'ws_x'
    };
    const result = store.importAll(payload, 'replace');
    assert.equal(result.mode, 'replace');
    assert.equal(result.importedProtectionOff, true);
    assert.equal(store.getSettings().contentProtection, true);
    assert.equal(store.listNotes().length, 1);
    assert.equal(store.listNotes()[0].visible, false);
    assert.equal(store.listNotes()[0].title, 'From backup');
  });

  it('rejects malformed import payloads with actionable errors', () => {
    const store = new Store(path.join(dir, 'c.json'));
    store.load();
    assert.throws(() => store.importAll(null), /Invalid import payload/);
    assert.throws(() => store.importAll({ notes: 'nope' }), /notes must be an array/);
  });
});

describe('deferred save errors keep dirty state', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-dirty-'));
    file = path.join(dir, 'data.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('flush rethrows when save is blocked and stays dirty', () => {
    fs.writeFileSync(file, '{bad', 'utf8');
    const store = new Store(file);
    store.load();
    assert.equal(store.isSaveBlocked(), true);
    assert.throws(() => store.flush(), /blocked/);
    assert.equal(store.isSaveBlocked(), true);
  });
});
