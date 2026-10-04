'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  launch,
  waitFor,
  waitForStore,
  firstNote,
  noteIdOf,
  noteWindow,
  openManager,
  openWindowIds,
  focusEditorEnd,
  noteCard,
  noteMenuAction,
  showNotes
} = require('./helpers');

let running = [];
afterEach(async () => {
  await Promise.all(running.map((app) => app.close().catch(() => {})));
  running = [];
});

async function start() {
  const ctx = await launch();
  running.push(ctx.app);
  ctx.note = await firstNote(ctx.app);
  ctx.manager = await openManager(ctx.app);
  return ctx;
}

const card = noteCard;

async function cardTitles(manager) {
  await manager.waitForTimeout(150);
  return manager.locator('.note-title').allTextContents();
}

async function newNoteFromTemplate(ctx, templateId) {
  const before = new Set(ctx.app.windows());
  await ctx.manager.click('#btnTemplates');
  await ctx.manager.click(`#menu [data-template="${templateId}"]`);
  const page = await waitFor(() => ctx.app.windows().find((w) => !before.has(w) && w.url().includes('note.html')), 'new note window');
  return noteWindow(ctx.app, noteIdOf(page));
}

describe('notes manager', () => {
  it('creates notes from templates and filters them by search and tag', async () => {
    const ctx = await start();
    const { manager } = ctx;
    const meeting = await newNoteFromTemplate(ctx, 'meeting');
    assert.equal(await meeting.inputValue('#title'), 'Meeting notes');
    await waitFor(async () => (await manager.locator('.note-card').count()) === 2, 'two cards');

    await manager.fill('#search', 'agenda');
    await waitFor(async () => (await cardTitles(manager)).join() === 'Meeting notes', 'search result');
    await manager.fill('#search', 'nothing-matches-this');
    await manager.waitForSelector('#empty:not(.hidden)');
    assert.equal(await manager.locator('#emptyTitle').textContent(), 'No matching notes');
    await manager.fill('#search', '');
    await waitFor(async () => (await manager.locator('.note-card').count()) === 2, 'search cleared');

    await noteMenuAction(manager, 'Meeting notes', 'Edit tags');
    await manager.fill('#mTags', 'standup, Team');
    await manager.click('#modalFooter .primary-btn');
    await waitForStore(ctx.dataFile, (s) => s.notes.some((n) => n.tags.join() === 'standup,team'), 'tags on disk');
    await manager.click('#tagList button:has-text("#standup")');
    await waitFor(async () => (await cardTitles(manager)).join() === 'Meeting notes', 'tag filter');
    assert.deepEqual(await meeting.locator('.tag-chip span:first-child').allTextContents(), ['#standup', '#team']);
  });

  it('renames in place, duplicates, moves, and trashes notes with undo', async () => {
    const ctx = await start();
    const { manager, dataFile } = ctx;
    const welcomeId = noteIdOf(ctx.note);

    await card(manager, 'Ghost Notetaker').locator('.note-title').dblclick();
    await manager.fill('.note-card .title-edit', 'Launch checklist');
    await manager.keyboard.press('Enter');
    await waitForStore(dataFile, (s) => s.notes[0]?.title === 'Launch checklist', 'rename on disk');
    await waitFor(async () => (await ctx.note.inputValue('#title')) === 'Launch checklist', 'note window renamed');

    // Escape cancels an in-place rename.
    await card(manager, 'Launch checklist').locator('.note-title').dblclick();
    await manager.fill('.note-card .title-edit', 'Not this');
    await manager.keyboard.press('Escape');
    await waitFor(async () => (await cardTitles(manager)).join() === 'Launch checklist', 'rename cancelled');

    await noteMenuAction(manager, 'Launch checklist', 'Duplicate');
    await waitForStore(dataFile, (s) => s.notes.length === 2, 'duplicate on disk');
    assert.deepEqual((await cardTitles(manager)).sort(), ['Launch checklist', 'Launch checklist (copy)']);

    await manager.click('#btnNewWs');
    await manager.fill('#mWsNew', 'Work');
    await manager.click('#modalFooter .primary-btn');
    await manager.waitForSelector('#empty:not(.hidden)');
    assert.equal(await manager.locator('#emptyTitle').textContent(), 'No notes in this workspace');
    await manager.click('#wsList button:has-text("Personal")');
    await waitFor(async () => (await manager.locator('.note-card').count()) === 2, 'back in Personal');

    await noteMenuAction(manager, 'Launch checklist (copy)', 'Move to workspace');
    const workId = await manager.locator('#mMoveWs option', { hasText: 'Work' }).getAttribute('value');
    await manager.selectOption('#mMoveWs', workId);
    await manager.click('#modalFooter .primary-btn');
    await waitFor(async () => (await cardTitles(manager)).join() === 'Launch checklist', 'moved away');
    const store = await waitForStore(dataFile, (s) => s.notes.some((n) => n.workspaceId === workId), 'move on disk');
    assert.equal(store.notes.filter((n) => n.workspaceId === workId).length, 1);

    await noteMenuAction(manager, 'Launch checklist', 'Move to trash');
    await waitForStore(dataFile, (s) => s.notes.find((n) => n.id === welcomeId)?.trashedAt, 'trashed on disk');
    await waitFor(async () => !(await openWindowIds(ctx.app)).includes(welcomeId), 'window closed');
    await waitFor(async () => /Launch checklist.*moved to the trash/.test(await manager.locator('#toastText').textContent()), 'trash message');
    await waitFor(async () => (await manager.locator('#trashCount').textContent()) === '1', 'trash count');

    // Undo brings the note back and puts it on screen again, as it was.
    await manager.click('#toastAction');
    await waitForStore(dataFile, (s) => {
      const n = s.notes.find((x) => x.id === welcomeId);
      return n && !n.trashedAt && n.visible;
    }, 'restored on disk');
    await noteWindow(ctx.app, welcomeId);
    await waitFor(async () => (await cardTitles(manager)).join() === 'Launch checklist', 'card back');

    // Delete forever only from the trash, after a confirmation.
    await noteMenuAction(manager, 'Launch checklist', 'Move to trash');
    await manager.click('#btnTrash');
    const trashed = manager.locator('#trashList .note-card', { hasText: 'Launch checklist' });
    await trashed.waitFor();
    await trashed.getByRole('button', { name: /Delete .* forever/ }).click();
    assert.match(await manager.locator('#modalBody').textContent(), /cannot be undone/);
    await manager.click('#modalFooter .danger-btn');
    await waitForStore(dataFile, (s) => !s.notes.some((n) => n.id === welcomeId), 'deleted on disk');
    await manager.waitForSelector('#trashEmpty:not(.hidden)');
  });

  it('restores from the trash and empties it', async () => {
    const ctx = await start();
    const { manager, dataFile } = ctx;
    await newNoteFromTemplate(ctx, 'todo');
    await waitFor(async () => (await manager.locator('.note-card').count()) === 2, 'two cards');
    await card(manager, 'Ghost Notetaker').click();
    await manager.keyboard.press('Delete');
    await waitForStore(dataFile, (s) => s.notes.filter((n) => n.trashedAt).length === 1, 'one trashed');
    await noteMenuAction(manager, 'Todo', 'Move to trash');
    await waitForStore(dataFile, (s) => s.notes.filter((n) => n.trashedAt).length === 2, 'two trashed');
    await manager.waitForSelector('#empty:not(.hidden)');

    await manager.click('#btnTrash');
    await manager.locator('#trashList').getByRole('button', { name: 'Restore Ghost Notetaker' }).click();
    await waitForStore(dataFile, (s) => s.notes.filter((n) => n.trashedAt).length === 1, 'one restored');
    await manager.click('#btnEmptyTrash');
    assert.match(await manager.locator('#modalBody').textContent(), /1 note will be deleted for good/);
    await manager.click('#modalFooter .danger-btn');
    const store = await waitForStore(dataFile, (s) => s.notes.length === 1, 'trash emptied');
    assert.equal(store.notes[0].title, 'Ghost Notetaker');
    assert.equal(store.notes[0].trashedAt, null);
    await showNotes(manager);
    await waitFor(async () => (await cardTitles(manager)).join() === 'Ghost Notetaker', 'restored card');
  });

  it('hiding from the manager keeps text the note had not saved yet', async () => {
    const ctx = await start();
    const id = noteIdOf(ctx.note);
    await focusEditorEnd(ctx.note);
    await ctx.note.keyboard.type('\nadded right before hiding');
    await card(ctx.manager, 'Ghost Notetaker').locator('button', { hasText: 'Hide' }).click();
    const store = await waitForStore(ctx.dataFile, (s) => s.notes[0]?.visible === false, 'hidden on disk');
    assert.match(store.notes[0].content, /added right before hiding$/);
    await waitFor(async () => (await openWindowIds(ctx.app)).length === 0, 'window closed');

    await card(ctx.manager, 'Ghost Notetaker').locator('button', { hasText: 'Open' }).click();
    const reopened = await noteWindow(ctx.app, id);
    assert.match(await reopened.inputValue('#editor'), /added right before hiding$/);
  });

  it('bulk hide and show work on the selected notes', async () => {
    const ctx = await start();
    await newNoteFromTemplate(ctx, 'todo');
    await waitFor(async () => (await ctx.manager.locator('.note-card').count()) === 2, 'two cards');
    await ctx.manager.check('#selectAll');
    assert.equal(await ctx.manager.locator('#selCount').textContent(), '2 selected');
    await ctx.manager.click('#btnBulkHide');
    await waitForStore(ctx.dataFile, (s) => s.notes.every((n) => !n.visible), 'all hidden');
    await waitFor(async () => (await openWindowIds(ctx.app)).length === 0, 'windows closed');
    await ctx.manager.check('#selectAll');
    await ctx.manager.click('#btnBulkShow');
    await waitForStore(ctx.dataFile, (s) => s.notes.every((n) => n.visible), 'all visible');
    await waitFor(async () => (await openWindowIds(ctx.app)).length === 2, 'windows reopened');
  });

  it('deleting a workspace moves its notes to the trash and closes their windows', async () => {
    const ctx = await start();
    const { manager } = ctx;
    await manager.click('#btnNewWs');
    await manager.fill('#mWsNew', 'Client call');
    await manager.click('#modalFooter .primary-btn');
    await manager.waitForSelector('#empty:not(.hidden)');
    const note = await newNoteFromTemplate(ctx, 'scratch');
    const id = noteIdOf(note);
    await waitFor(async () => (await manager.locator('.note-card').count()) === 1, 'note in workspace');

    await manager.locator('#wsList .side-row', { hasText: 'Client call' }).hover();
    await manager.click('#wsList button[aria-label="Delete workspace Client call"]');
    assert.match(await manager.locator('#modalBody').textContent(), /Its 1 note moves to the trash/);
    await manager.click('#modalFooter .danger-btn');
    await waitForStore(
      ctx.dataFile,
      (s) => s.workspaces.length === 1 && s.notes.find((n) => n.id === id)?.trashedAt,
      'workspace gone, note in the trash'
    );
    await waitFor(async () => !(await openWindowIds(ctx.app)).includes(id), 'its window closed');
    await waitFor(
      async () => (await manager.locator('#wsList .side-btn .label').allTextContents()).join() === 'Personal',
      'workspace list updated'
    );
    await waitFor(async () => (await manager.locator('#trashCount').textContent()) === '1', 'trash count');
  });

  it('click-through set on a note can be turned off from the manager', async () => {
    const ctx = await start();
    await ctx.note.click('#btnGhost');
    await waitForStore(ctx.dataFile, (s) => s.notes[0]?.clickThrough === true, 'click-through on');
    const row = card(ctx.manager, 'Ghost Notetaker');
    await row.locator('.pill.warn').click();
    await waitForStore(ctx.dataFile, (s) => s.notes[0]?.clickThrough === false, 'click-through off');
    await waitFor(async () => (await ctx.note.getAttribute('#btnGhost', 'aria-pressed')) === 'false', 'note button updated');
  });

  it('reports failed disk writes and recovers on its own when the disk is writable again', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
    const ctx = await start();
    await focusEditorEnd(ctx.note);
    fs.chmodSync(ctx.userDataDir, 0o500);
    try {
      await ctx.note.keyboard.type('needs a retry');
      await ctx.note.waitForSelector('#saveStatus:not([hidden])', { timeout: 10000 });
      assert.match(await ctx.note.locator('#saveStatus').textContent(), /Not written to disk yet/);
      await ctx.manager.waitForSelector('#saveBanner:not([hidden])');
      assert.match(await ctx.manager.locator('#saveBanner').textContent(), /cannot be written.*EACCES/);
    } finally {
      fs.chmodSync(ctx.userDataDir, 0o700);
    }
    // No further typing: the store retries on its own and the warnings clear.
    await waitForStore(ctx.dataFile, (s) => s.notes[0]?.content.includes('needs a retry'), 'retried save');
    await ctx.note.waitForSelector('#saveStatus[hidden]', { state: 'attached', timeout: 10000 });
    await ctx.manager.waitForSelector('#saveBanner[hidden]', { state: 'attached', timeout: 10000 });
  });
  it('board and list views, and the choice is remembered', async () => {
    const ctx = await start();
    const { manager, dataFile } = ctx;
    assert.match(await manager.getAttribute('#noteList', 'class'), /\bboard\b/);
    await manager.click('#btnList');
    assert.match(await manager.getAttribute('#noteList', 'class'), /\blist\b/);
    assert.equal(await manager.getAttribute('#btnList', 'aria-pressed'), 'true');
    await waitForStore(dataFile, (s) => s.settings.managerView === 'list', 'layout on disk');

    await ctx.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('manager.html')).close();
    });
    await waitFor(async () => !ctx.app.windows().some((w) => w.url().includes('manager.html')), 'manager closed');
    const again = await openManager(ctx.app);
    assert.match(await again.getAttribute('#noteList', 'class'), /\blist\b/);
  });

  it('keyboard: arrows move between notes, F2 renames, Delete trashes, Enter opens', async () => {
    const ctx = await start();
    const { manager, dataFile } = ctx;
    await newNoteFromTemplate(ctx, 'todo');
    await waitFor(async () => (await manager.locator('.note-card').count()) === 2, 'two cards');
    const focusedTitle = () => manager.evaluate(() => document.activeElement.querySelector('.note-title')?.textContent);

    await manager.click('#search');
    await manager.keyboard.press('ArrowDown');
    const first = await focusedTitle();
    await manager.keyboard.press('ArrowRight');
    const second = await focusedTitle();
    assert.deepEqual([first, second].sort(), ['Ghost Notetaker', 'Todo list']);

    await manager.keyboard.press('F2');
    await manager.keyboard.type('Renamed by keyboard');
    await manager.keyboard.press('Enter');
    await waitForStore(dataFile, (s) => s.notes.some((n) => n.title === 'Renamed by keyboard'), 'renamed');

    await card(manager, 'Renamed by keyboard').focus();
    await manager.keyboard.press('Delete');
    await waitForStore(dataFile, (s) => s.notes.find((n) => n.title === 'Renamed by keyboard')?.trashedAt, 'trashed');
    await manager.click('#toastAction');
    await waitForStore(dataFile, (s) => s.notes.find((n) => n.title === 'Renamed by keyboard')?.trashedAt === null, 'undone');

    const hidden = (await waitForStore(dataFile, () => true)).notes.find((n) => n.title === 'Renamed by keyboard');
    await card(manager, 'Renamed by keyboard').locator('.open-btn', { hasText: 'Hide' }).click();
    await waitFor(async () => !(await openWindowIds(ctx.app)).includes(hidden.id), 'hidden');
    await card(manager, 'Renamed by keyboard').focus();
    await manager.keyboard.press('Enter');
    await waitFor(async () => (await openWindowIds(ctx.app)).includes(hidden.id), 'opened with Enter');

    await manager.keyboard.press('/');
    assert.equal(await manager.evaluate(() => document.activeElement.id), 'search');

    const before = new Set(ctx.app.windows());
    await manager.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+N`);
    await waitFor(() => ctx.app.windows().find((w) => !before.has(w) && w.url().includes('note.html')), 'note from Ctrl/Cmd+N');
  });

  it('changes a note color from its right-click menu', async () => {
    const ctx = await start();
    await ctx.manager.click('.note-card', { button: 'right' });
    await ctx.manager.waitForSelector('#menu:not(.hidden)');
    await ctx.manager.click('#menu .swatch-btn[data-color="teal"]');
    await waitForStore(ctx.dataFile, (s) => s.notes[0]?.color === 'teal', 'color on disk');
    await waitFor(async () => ctx.note.evaluate(() => document.getElementById('shell').classList.contains('ink-light')), 'note window recolored');
    await waitFor(async () => /ink-light/.test(await ctx.manager.getAttribute('.note-card', 'class')), 'card recolored');
  });
});
