'use strict';

// Restore and Delete forever in the Trash keep keyboard focus in the list
// (WCAG 2.4.3): next row, else the previous one, else the Trash heading.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor, waitForStore, openManager } = require('./helpers');

let running = [];
afterEach(async () => {
  await Promise.all(running.map((app) => app.close().catch(() => {})));
  running = [];
});

const focused = (manager) =>
  manager.evaluate(() => {
    const a = document.activeElement;
    return a === document.body ? 'BODY' : a.getAttribute('aria-label') || a.id || a.tagName;
  });

describe('trash focus', () => {
  it('after a keyboard Restore focus goes to the next row, then the previous one, then the heading', async () => {
    const ctx = await launch();
    running.push(ctx.app);
    const manager = await openManager(ctx.app);
    for (const title of ['Gone A', 'Gone B', 'Gone C']) {
      const note = await manager.evaluate((t) => window.ghostManager.createNote({ title: t, content: t }), title);
      await manager.evaluate((id) => window.ghostManager.trashNote(id), note.id);
    }
    await manager.click('#btnTrash');
    await waitFor(async () => (await manager.locator('#trashList .note-card').count()) === 3, 'three in the trash');
    const order = await manager.locator('#trashList .note-title').allTextContents();

    // Middle row: focus moves to the row that takes its place.
    await manager.getByRole('button', { name: `Restore ${order[1]}` }).focus();
    await manager.keyboard.press('Enter');
    await waitForStore(ctx.dataFile, (s) => s.notes.some((n) => n.title === order[1] && !n.trashedAt), 'restored');
    await waitFor(async () => (await focused(manager)) === `Restore ${order[2]}`, `focus on Restore ${order[2]}`);

    // Last row: focus moves back to the one before it.
    await manager.keyboard.press('Enter');
    await waitForStore(ctx.dataFile, (s) => s.notes.some((n) => n.title === order[2] && !n.trashedAt), 'restored');
    await waitFor(async () => (await focused(manager)) === `Restore ${order[0]}`, `focus on Restore ${order[0]}`);

    // Last one left: focus goes to the Trash heading.
    await manager.keyboard.press('Enter');
    await waitForStore(ctx.dataFile, (s) => s.notes.some((n) => n.title === order[0] && !n.trashedAt), 'restored');
    await waitFor(async () => (await focused(manager)) === 'trashTitle', 'focus on the Trash heading');
    assert.equal(await manager.locator('#trashEmpty').isVisible(), true);
  });

  it('after Delete forever focus stays in the trash list', async () => {
    const ctx = await launch();
    running.push(ctx.app);
    const manager = await openManager(ctx.app);
    for (const title of ['Old X', 'Old Y']) {
      const note = await manager.evaluate((t) => window.ghostManager.createNote({ title: t, content: t }), title);
      await manager.evaluate((id) => window.ghostManager.trashNote(id), note.id);
    }
    await manager.click('#btnTrash');
    await waitFor(async () => (await manager.locator('#trashList .note-card').count()) === 2, 'two in the trash');
    const order = await manager.locator('#trashList .note-title').allTextContents();
    await manager.getByRole('button', { name: `Delete forever ${order[0]}` }).focus();
    await manager.keyboard.press('Enter');
    await manager.locator('#modalFooter .danger-btn').focus();
    await manager.keyboard.press('Enter');
    await waitFor(async () => (await focused(manager)) === `Delete forever ${order[1]}`, `focus on Delete forever ${order[1]}`);
  });
  async function trashOf(ctx, manager, titles) {
    for (const title of titles) {
      const note = await manager.evaluate((t) => window.ghostManager.createNote({ title: t, content: t }), title);
      await manager.evaluate((id) => window.ghostManager.trashNote(id), note.id);
    }
    await manager.click('#btnTrash');
    await waitFor(async () => (await manager.locator('#trashList .note-card').count()) === titles.length, 'notes in the trash');
    return manager.locator('#trashList .note-title').allTextContents();
  }

  async function confirmDelete(manager, title) {
    await manager.getByRole('button', { name: `Delete forever ${title}` }).focus();
    await manager.keyboard.press('Enter');
    await manager.locator('#modalFooter .danger-btn').focus();
    await manager.keyboard.press('Enter');
  }

  it('Delete forever from its dialog: same row, else the previous one, else the heading', async () => {
    const ctx = await launch();
    running.push(ctx.app);
    const manager = await openManager(ctx.app);
    const order = await trashOf(ctx, manager, ['Del A', 'Del B', 'Del C']);
    await confirmDelete(manager, order[1]);
    await waitFor(async () => (await focused(manager)) === `Delete forever ${order[2]}`, `focus on Delete forever ${order[2]}`);
    await confirmDelete(manager, order[2]);
    await waitFor(async () => (await focused(manager)) === `Delete forever ${order[0]}`, `focus on Delete forever ${order[0]}`);
    await confirmDelete(manager, order[0]);
    await waitFor(async () => (await focused(manager)) === 'trashTitle', 'focus on the Trash heading');
    await manager.waitForTimeout(400);
    assert.equal(await focused(manager), 'trashTitle', 'focus stays on the heading');
  });

  it('Empty trash moves focus to the Trash heading, not its disabled button', async () => {
    const ctx = await launch();
    running.push(ctx.app);
    const manager = await openManager(ctx.app);
    await trashOf(ctx, manager, ['Bin A', 'Bin B']);
    await manager.focus('#btnEmptyTrash');
    await manager.keyboard.press('Enter');
    await manager.locator('#modalFooter .danger-btn').focus();
    await manager.keyboard.press('Enter');
    await waitFor(async () => (await focused(manager)) === 'trashTitle', 'focus on the Trash heading');
    await manager.waitForTimeout(400);
    assert.equal(await focused(manager), 'trashTitle', 'focus stays on the heading');
    assert.equal(await manager.locator('#trashEmpty').isVisible(), true);
  });

  it('a failed Delete forever forgets its focus target', async () => {
    const ctx = await launch();
    running.push(ctx.app);
    const manager = await openManager(ctx.app);
    const order = await trashOf(ctx, manager, ['Keep A', 'Keep B']);
    await ctx.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('notes:delete');
      ipcMain.handle('notes:delete', () => {
        throw new Error('disk full');
      });
    });
    await confirmDelete(manager, order[0]);
    await manager.locator('#modal .modal-error, #modal [role="alert"]').first().waitFor().catch(() => {});
    await manager.keyboard.press('Escape');
    await waitFor(async () => (await focused(manager)) === `Delete forever ${order[0]}`, 'focus back on its opener');
    // A later change re-renders the trash; focus must not jump.
    await manager.evaluate(() => window.ghostManager.createNote({ title: 'Later', content: 'x' }));
    await manager.waitForTimeout(600);
    assert.equal(await focused(manager), `Delete forever ${order[0]}`);
    assert.equal(await manager.locator('#trashList .note-card').count(), 2);
  });

  it('a dialog whose action fails moves focus to its error, not the page', async () => {
    const ctx = await launch();
    running.push(ctx.app);
    const manager = await openManager(ctx.app);
    const order = await trashOf(ctx, manager, ['Err A']);
    await ctx.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('notes:delete');
      ipcMain.handle('notes:delete', () => {
        throw new Error('disk full');
      });
    });
    await confirmDelete(manager, order[0]);
    await manager.locator('#modal .modal-error').waitFor();
    const where = () => manager.evaluate(() => (document.activeElement.classList.contains('modal-error') ? 'error' : document.activeElement.tagName));
    await waitFor(async () => (await where()) === 'error', 'focus on the error message');
    assert.match(await manager.evaluate(() => document.activeElement.textContent), /disk full/);
    await manager.keyboard.press('Tab');
    assert.equal(await manager.evaluate(() => document.activeElement.closest('#modalFooter') !== null), true, 'Tab reaches the dialog buttons');
  });
});
