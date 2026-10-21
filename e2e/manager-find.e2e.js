'use strict';

// Finding notes in the Notes Manager: search words and highlights, the paper
// filter, empty states that say what to do next, and the manager's own keys.

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor, waitForStore, firstNote, noteIdOf, noteWindow, openManager, noteCard, noteMenuAction, modKey } = require('./helpers');

let running = [];
afterEach(async () => {
  await Promise.all(running.map((app) => app.close().catch(() => {})));
  running = [];
});

/** The welcome note plus three hidden notes on different papers. */
async function start() {
  const ctx = await launch();
  running.push(ctx.app);
  ctx.note = await firstNote(ctx.app);
  ctx.manager = await openManager(ctx.app);
  const ws = await ctx.manager.evaluate(() => window.ghostManager.getBootstrap().then((b) => b.activeWorkspaceId));
  const make = (title, content, color, tags = []) =>
    ctx.manager.evaluate((o) => window.ghostManager.createNote({ ...o, visible: false }), { workspaceId: ws, title, content, color, tags });
  await make('Groceries', '- Oat milk\n- Crème fraîche\n- Lemons', 'mint', ['shopping']);
  await make('Pancakes', '| Flour | 200 g |\n| --- | --- |\n| Milk | 300 ml |', 'peach', ['recipes']);
  await make('Call notes', 'Ask about the café booking', 'mint');
  await waitFor(async () => (await ctx.manager.locator('.note-card').count()) === 4, 'four cards');
  return ctx;
}

const titles = async (manager) => (await manager.locator('#noteList .note-title').allTextContents()).sort();

describe('finding notes in the manager', () => {
  it('search matches every word, ignores accents, and highlights the hits', async () => {
    const { manager } = await start();
    await manager.fill('#search', 'milk');
    await waitFor(async () => (await titles(manager)).join() === 'Groceries,Pancakes', 'two milk notes');
    assert.deepEqual(
      [...new Set((await manager.locator('#noteList .note-snippet mark.hit').allTextContents()).map((t) => t.toLowerCase()))],
      ['milk']
    );
    assert.match(await manager.locator('#viewSub').textContent(), /Showing 2 of 4 notes/);

    await manager.fill('#search', 'oat milk');
    await waitFor(async () => (await titles(manager)).join() === 'Groceries', 'both words');

    // "creme" finds "Crème", and the mark keeps the accented letters.
    await manager.fill('#search', 'creme');
    await waitFor(
      async () => (await manager.locator('#noteList .note-snippet mark.hit').allTextContents()).join() === 'Crème',
      'accent-free hit'
    );
    assert.equal((await titles(manager)).join(), 'Groceries');

    // In the board, hits are marked in the formatted preview too.
    await manager.click('#btnBoard');
    await manager.fill('#search', 'cafe');
    await waitFor(async () => (await titles(manager)).join() === 'Call notes', 'board search');
    assert.equal(await manager.locator('#noteList .card-body mark.hit').first().textContent(), 'café');
    // Highlighting never changes the title text.
    await manager.fill('#search', 'call');
    await waitFor(async () => (await manager.locator('#noteList .note-title mark.hit').count()) === 1, 'title hit');
    assert.equal(await manager.locator('#noteList .note-title').first().textContent(), 'Call notes');
  });

  it('the paper filter shows notes on the chosen papers and combines with search', async () => {
    const { manager } = await start();
    const mint = manager.locator('#paperFilter [data-color="mint"]');
    await mint.click();
    assert.equal(await mint.getAttribute('aria-pressed'), 'true');
    await waitFor(async () => (await titles(manager)).join() === 'Call notes,Groceries', 'mint notes');
    assert.equal(await manager.locator('#countAll').textContent(), '2');

    await manager.click('#paperFilter [data-color="peach"]');
    await waitFor(async () => (await titles(manager)).length === 3, 'mint and peach');

    await manager.fill('#search', 'milk');
    await waitFor(async () => (await titles(manager)).join() === 'Groceries,Pancakes', 'paper + search');

    await manager.click('#btnClearAll');
    await waitFor(async () => (await titles(manager)).length === 4, 'filters cleared');
    assert.equal(await manager.inputValue('#search'), '');
    assert.equal(await mint.getAttribute('aria-pressed'), 'false');
    assert.equal(await manager.isHidden('#btnClearAll'), true);
  });

  it('empty states say what is filtered and offer the next step', async () => {
    const { manager } = await start();
    await manager.fill('#search', 'zebra');
    await manager.waitForSelector('#empty:not(.hidden)');
    assert.equal(await manager.locator('#emptyTitle').textContent(), 'No matching notes');
    assert.match(await manager.locator('#emptyHint').textContent(), /matches “zebra”/);
    assert.equal(await manager.isVisible('#btnEmptyNew'), false);
    await manager.click('#btnClearFilters');
    await waitFor(async () => (await titles(manager)).length === 4, 'back to all notes');
    assert.equal(await manager.evaluate(() => document.activeElement.id), 'search');

    // A workspace with no notes offers a new note instead.
    await manager.click('#btnNewWs');
    await manager.fill('#mWsNew', 'Empty one');
    await manager.click('#modalFooter .primary-btn');
    await manager.waitForSelector('#empty:not(.hidden)');
    assert.equal(await manager.locator('#emptyTitle').textContent(), 'No notes in this workspace');
    assert.match(await manager.locator('#emptyHint').textContent(), /Empty one/);
    assert.equal(await manager.isVisible('#btnEmptyNew'), true);
    assert.equal(await manager.isVisible('#btnClearFilters'), false);
    assert.equal(await manager.isVisible('#loading'), false);
  });

  it('keys: Ctrl/Cmd+1 and 2 switch views, ? lists the keys, Escape clears the search', async () => {
    const { manager } = await start();
    await manager.evaluate(() => document.activeElement.blur());
    await manager.keyboard.press(`${modKey}+2`);
    await waitFor(async () => /\bboard\b/.test(await manager.getAttribute('#noteList', 'class')), 'board view');
    assert.equal(await manager.getAttribute('#btnBoard', 'aria-pressed'), 'true');
    await manager.keyboard.press(`${modKey}+1`);
    await waitFor(async () => /\blist\b/.test(await manager.getAttribute('#noteList', 'class')), 'list view');

    await manager.keyboard.press('Shift+Slash');
    await manager.waitForSelector('#modal:not(.hidden) #keysSheet');
    assert.match(await manager.locator('#keysSheet').textContent(), /Board view/);
    await manager.keyboard.press('Escape');
    await manager.waitForSelector('#modal.hidden', { state: 'attached' });

    await manager.keyboard.press('/');
    await manager.keyboard.type('pancakes');
    await waitFor(async () => (await titles(manager)).join() === 'Pancakes', 'typed search');
    await manager.keyboard.press('ArrowDown');
    assert.equal(await manager.evaluate(() => document.activeElement.querySelector('.note-title')?.textContent), 'Pancakes');
    await manager.locator('#search').focus();
    await manager.keyboard.press('Escape');
    await waitFor(async () => (await titles(manager)).length === 4, 'search cleared by Escape');
  });

  it('"Keep on top" in the card menu turns always-on-top off and on, like the switch in the note', async () => {
    const ctx = await start();
    const id = noteIdOf(ctx.note);
    const item = () => ctx.manager.locator('#menu .menu-item', { hasText: 'Keep on top' });
    await noteCard(ctx.manager, 'Ghost Notetaker').first().click({ button: 'right' });
    assert.equal(await item().getAttribute('role'), 'menuitemcheckbox');
    assert.equal(await item().getAttribute('aria-checked'), 'true');
    await item().click();
    await waitForStore(ctx.dataFile, (s) => s.notes.find((n) => n.id === id)?.pinned === false, 'unpinned on disk');
    const onTop = () =>
      ctx.app.evaluate(({ BrowserWindow }, noteId) =>
        BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`id=${noteId}`)).isAlwaysOnTop(), id);
    await waitFor(async () => (await onTop()) === false, 'window not on top');
    const note = await noteWindow(ctx.app, id);
    await waitFor(async () => (await note.getAttribute('#btnPin', 'aria-checked')) === 'false', 'note pin switch updated');

    await noteMenuAction(ctx.manager, 'Ghost Notetaker', 'Keep on top');
    await waitForStore(ctx.dataFile, (s) => s.notes.find((n) => n.id === id)?.pinned === true, 'pinned again');
    await waitFor(async () => (await onTop()) === true, 'window on top again');
  });
});
