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
  focusEditorEnd
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

const card = (manager, title) => manager.locator('.note-card', { has: manager.locator('.note-title', { hasText: title }) });

async function cardTitles(manager) {
  await manager.waitForTimeout(150);
  return manager.locator('.note-title').allTextContents();
}

async function newNoteFromTemplate(ctx, templateId) {
  const before = new Set(ctx.app.windows());
  await ctx.manager.selectOption('#templateSelect', templateId);
  await ctx.manager.click('#btnNewNote');
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

    await card(manager, 'Meeting notes').locator('button', { hasText: 'Tags' }).click();
    await manager.fill('#mTags', 'standup, Team');
    await manager.click('#modalFooter .primary-btn');
    await waitForStore(ctx.dataFile, (s) => s.notes.some((n) => n.tags.join() === 'standup,team'), 'tags on disk');
    await manager.click('#tagList button:has-text("#standup")');
    await waitFor(async () => (await cardTitles(manager)).join() === 'Meeting notes', 'tag filter');
    assert.deepEqual(await meeting.locator('.tag-chip span:first-child').allTextContents(), ['#standup', '#team']);
  });

  it('renames, duplicates, moves, and deletes notes', async () => {
    const ctx = await start();
    const { manager, dataFile } = ctx;
    const welcomeId = noteIdOf(ctx.note);

    await card(manager, 'Ghost Notetaker').locator('button', { hasText: 'Rename' }).click();
    await manager.fill('#mTitle', 'Launch checklist');
    await manager.click('#modalFooter .primary-btn');
    await waitForStore(dataFile, (s) => s.notes[0]?.title === 'Launch checklist', 'rename on disk');
    await waitFor(async () => (await ctx.note.inputValue('#title')) === 'Launch checklist', 'note window renamed');

    await card(manager, 'Launch checklist').locator('button', { hasText: 'Duplicate' }).click();
    await waitForStore(dataFile, (s) => s.notes.length === 2, 'duplicate on disk');
    assert.deepEqual((await cardTitles(manager)).sort(), ['Launch checklist', 'Launch checklist (copy)']);

    await manager.click('#btnNewWs');
    await manager.fill('#mWsNew', 'Work');
    await manager.click('#modalFooter .primary-btn');
    await manager.waitForSelector('#empty:not(.hidden)');
    assert.equal(await manager.locator('#emptyTitle').textContent(), 'No notes in this workspace');
    await manager.click('#wsList button:has-text("Personal")');
    await waitFor(async () => (await manager.locator('.note-card').count()) === 2, 'back in Personal');

    await card(manager, 'Launch checklist (copy)').locator('button', { hasText: 'Move' }).click();
    const workId = await manager.locator('#mMoveWs option', { hasText: 'Work' }).getAttribute('value');
    await manager.selectOption('#mMoveWs', workId);
    await manager.click('#modalFooter .primary-btn');
    await waitFor(async () => (await cardTitles(manager)).join() === 'Launch checklist', 'moved away');
    const store = await waitForStore(dataFile, (s) => s.notes.some((n) => n.workspaceId === workId), 'move on disk');
    assert.equal(store.notes.filter((n) => n.workspaceId === workId).length, 1);

    await card(manager, 'Launch checklist').locator('button', { hasText: 'Delete' }).click();
    assert.match(await manager.locator('#modalBody').textContent(), /cannot be undone/);
    await manager.click('#modalFooter .danger-btn');
    await waitForStore(dataFile, (s) => !s.notes.some((n) => n.id === welcomeId), 'delete on disk');
    await waitFor(async () => !(await openWindowIds(ctx.app)).includes(welcomeId), 'window closed');
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

  it('deleting a workspace deletes its notes and closes their windows', async () => {
    const ctx = await start();
    const { manager } = ctx;
    await manager.click('#btnNewWs');
    await manager.fill('#mWsNew', 'Client call');
    await manager.click('#modalFooter .primary-btn');
    await manager.waitForSelector('#empty:not(.hidden)');
    const note = await newNoteFromTemplate(ctx, 'scratch');
    const id = noteIdOf(note);
    await waitFor(async () => (await manager.locator('.note-card').count()) === 1, 'note in workspace');

    await manager.click('#wsList button[aria-label="Delete workspace Client call"]');
    assert.match(await manager.locator('#modalBody').textContent(), /its 1 note/);
    await manager.click('#modalFooter .danger-btn');
    await waitForStore(ctx.dataFile, (s) => s.workspaces.length === 1 && !s.notes.some((n) => n.id === id), 'workspace gone');
    await waitFor(async () => !(await openWindowIds(ctx.app)).includes(id), 'its window closed');
    assert.deepEqual(await manager.locator('#wsList .side-btn').allTextContents(), ['Personal']);
  });

  it('click-through set on a note can be turned off from the manager', async () => {
    const ctx = await start();
    await ctx.note.click('#btnGhost');
    await waitForStore(ctx.dataFile, (s) => s.notes[0]?.clickThrough === true, 'click-through on');
    const row = card(ctx.manager, 'Ghost Notetaker');
    await row.locator('.pill.warn').waitFor();
    await row.locator('button', { hasText: 'Turn off click-through' }).click();
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
});
