'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, normalizeBounds } = require('../main/store');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-txn-'));
  const file = path.join(dir, 'store.json');
  const store = new Store(file); store.load();
  t.after(() => { if (store._saveTimer) clearTimeout(store._saveTimer); fs.rmSync(dir, { recursive: true, force: true }); });
  store.createNote({ title: 'Keep me' }); store.flush();
  return { store, file, dir };
}
test('malformed import rows cannot leave a partial merge', t => {
  const { store, file } = setup(t);
  const before = JSON.stringify(store.state);
  const bytes = fs.readFileSync(file);
  assert.throws(() => store.importAll({ workspaces: [{ name: 'Partial' }], notes: [{ title: 'Valid' }, null] }), /Invalid notes/);
  assert.equal(JSON.stringify(store.state), before);
  assert.deepEqual(fs.readFileSync(file), bytes);
});
test('failed import persistence restores state and keeps the original file', t => {
  const { store, file, dir } = setup(t);
  const before = JSON.stringify(store.state);
  const bytes = fs.readFileSync(file);
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated rename failure'); };
  try { assert.throws(() => store.importAll({ notes: [{ title: 'New' }] }), /rename failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(JSON.stringify(store.state), before);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.tmp')), false);
});
test('imports persist before success and reject incompatible versions and duplicate ids', t => {
  const { store, file } = setup(t);
  assert.throws(() => store.importAll({ version: 999, notes: [] }), /version/);
  assert.throws(() => store.importAll({ notes: [{ id: 'same' }, { id: 'same' }] }, 'replace'), /duplicate/);
  store.importAll({ notes: [{ title: 'Imported' }] });
  assert.ok(JSON.parse(fs.readFileSync(file)).notes.some(note => note.title === 'Imported'));
});
test('bounds remain finite and within safe window limits', () => {
  const bounds = normalizeBounds({ x: Infinity, y: -Infinity, width: Infinity, height: 1e100 });
  assert.ok(Object.values(bounds).every(Number.isFinite));
  assert.ok(bounds.width <= 16384 && bounds.height <= 16384);
  assert.ok(normalizeBounds(null).width >= 200);
});
