'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, foldSearch, searchTerms, noteMatchesSearch } = require('../main/store');

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-search-'));
  const store = new Store(path.join(dir, 'data.json'));
  store.load();
  return store;
}

describe('note search', () => {
  it('folds case and accents', () => {
    assert.equal(foldSearch('Café CRÈME Ångström'), 'cafe creme angstrom');
    assert.equal(foldSearch(null), '');
  });

  it('splits a query into words', () => {
    assert.deepEqual(searchTerms('  Oat   MILK '), ['oat', 'milk']);
    assert.deepEqual(searchTerms(''), []);
  });

  it('needs every word somewhere in the title, text, or tags', () => {
    const note = { title: 'Groceries', content: '- Oat milk\n- Crème fraîche', tags: ['shopping'] };
    assert.ok(noteMatchesSearch(note, searchTerms('milk groceries')));
    assert.ok(noteMatchesSearch(note, searchTerms('creme')));
    assert.ok(noteMatchesSearch(note, searchTerms('shop oat')));
    assert.ok(!noteMatchesSearch(note, searchTerms('milk butter')));
    assert.ok(noteMatchesSearch(note, []));
  });

  it('listNotes filters by query words and by paper color', () => {
    const store = freshStore();
    const ws = store.getActiveWorkspaceId();
    store.createNote({ workspaceId: ws, title: 'Café list', content: 'beans', color: 'mint' });
    store.createNote({ workspaceId: ws, title: 'Errands', content: 'cafe then bank', color: 'amber' });
    store.createNote({ workspaceId: ws, title: 'Other', content: 'nothing', color: 'mint' });
    const titles = (filter) => store.listNotes({ workspaceId: ws, sortBy: 'title', ...filter }).map((n) => n.title);
    assert.deepEqual(titles({ query: 'cafe' }), ['Café list', 'Errands']);
    assert.deepEqual(titles({ query: 'café bank' }), ['Errands']);
    assert.deepEqual(titles({ colors: ['mint'] }), ['Café list', 'Other']);
    assert.deepEqual(titles({ colors: ['mint', 'amber'], query: 'cafe' }), ['Café list', 'Errands']);
    assert.deepEqual(titles({ colors: [] }).length, 3);
  });
});
