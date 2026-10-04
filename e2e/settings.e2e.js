'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  launch,
  waitFor,
  waitForStore,
  firstNote,
  openManager,
  noteIdOf,
  noteWindow
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
  await waitForStore(ctx.dataFile, (s) => s.notes.length === 1, 'welcome note on disk');
  return ctx;
}

const primary = process.platform === 'darwin' ? 'Meta' : 'Control';
const row = (manager, label) =>
  manager.locator('.shortcut-table tbody tr', { has: manager.locator('td:first-child', { hasText: label }) });

describe('keyboard shortcuts and preferences', () => {
  it('lists every shortcut with whether it could be registered', async () => {
    const { manager } = await start();
    await manager.click('#btnShortcuts');
    await manager.waitForSelector('.shortcut-table tbody tr');
    assert.equal(await manager.locator('.shortcut-table tbody tr').count(), 7);
    assert.equal(await row(manager, /^Toggle Markdown preview/).locator('.status').textContent(), 'In notes only');
    const statuses = await manager.locator('.shortcut-table tbody .status').allTextContents();
    assert.ok(statuses.every((s) => ['Works everywhere', 'In notes only', 'Taken by another app or the OS'].includes(s)), statuses.join());
  });

  it('records a new shortcut, refuses duplicates, clears, and resets', async () => {
    const { manager, dataFile } = await start();
    await manager.click('#btnShortcuts');
    await manager.waitForSelector('.shortcut-table tbody tr');

    await row(manager, /^New note$/).getByRole('button', { name: /Change shortcut/ }).click();
    await manager.waitForSelector('.kbd.recording');
    await manager.keyboard.press(`${primary}+Alt+K`);
    await waitForStore(dataFile, (s) => s.settings.shortcuts.newNote === 'CommandOrControl+Alt+K', 'new binding on disk');
    const shown = process.platform === 'darwin' ? '⌥⌘K' : 'Ctrl+Alt+K';
    await waitFor(async () => (await row(manager, /^New note$/).locator('.kbd').textContent()) === shown, 'row updated');

    await row(manager, /^Quick capture/).getByRole('button', { name: /Change shortcut/ }).click();
    await manager.keyboard.press(`${primary}+Alt+K`);
    await manager.waitForSelector('.field-hint.error');
    assert.match(await manager.locator('.field-hint.error').textContent(), /already used for "New note"/);

    await row(manager, /^Quick capture/).getByRole('button', { name: /Clear shortcut/ }).click();
    await waitForStore(dataFile, (s) => s.settings.shortcuts.quickCapture === '', 'cleared on disk');
    await waitFor(async () => (await row(manager, /^Quick capture/).locator('.status').textContent()) === 'Off', 'shown as off');

    await manager.click('#modalFooter button:has-text("Reset to defaults")');
    await waitForStore(
      dataFile,
      (s) => s.settings.shortcuts.newNote === 'CommandOrControl+Shift+N' && s.settings.shortcuts.quickCapture === 'CommandOrControl+Shift+Q',
      'defaults on disk'
    );
  });

  it('Escape cancels recording without changing the shortcut', async () => {
    const { manager, dataFile } = await start();
    await manager.click('#btnShortcuts');
    await manager.waitForSelector('.shortcut-table tbody tr');
    await row(manager, /^Hide \/ show all/).getByRole('button', { name: /Change shortcut/ }).click();
    await manager.waitForSelector('.kbd.recording');
    await manager.keyboard.press('Escape');
    await manager.waitForSelector('.kbd.recording', { state: 'detached' });
    assert.equal(await manager.isVisible('#modal'), true, 'Escape while recording must not close the dialog');
    await manager.keyboard.press('Escape');
    await manager.waitForSelector('#modal.hidden', { state: 'attached' });
    await new Promise((r) => setTimeout(r, 400));
    const store = await waitForStore(dataFile, () => true);
    assert.equal(store.settings.shortcuts.hideShowAll, 'CommandOrControl+Shift+H');
  });

  it('preferences set the defaults for new notes', async () => {
    const ctx = await start();
    const { manager, dataFile } = ctx;
    await manager.click('#btnSettings');
    await manager.selectOption('#sColor', 'rose');
    await manager.locator('#sOpacity').fill('50');
    await manager.fill('#sFont', '20');
    await manager.check('#sMono');
    await manager.click('#modalFooter .primary-btn');
    await manager.waitForSelector('#toast:not(.hidden)');
    await waitForStore(dataFile, (s) => s.settings.defaultColor === 'rose' && s.settings.defaultFontSize === 20, 'settings on disk');

    const before = new Set(ctx.app.windows());
    await manager.click('#btnNewNote');
    const page = await waitFor(() => ctx.app.windows().find((w) => !before.has(w) && w.url().includes('note.html')), 'new note');
    const id = noteIdOf(page);
    await noteWindow(ctx.app, id);
    const store = await waitForStore(dataFile, (s) => s.notes.some((n) => n.id === id), 'new note on disk');
    const created = store.notes.find((n) => n.id === id);
    assert.equal(created.color, 'rose');
    assert.equal(created.opacity, 0.5);
    assert.equal(created.fontSize, 20);
    assert.equal(created.monospace, true);
  });

  it('screen-capture and login options match what the OS supports', async () => {
    const ctx = await start();
    await ctx.manager.click('#btnSettings');
    const protect = ctx.manager.locator('#sProtect');
    const login = ctx.manager.locator('#sLogin');
    const protectedNow = () =>
      ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isContentProtected()));
    if (process.platform === 'linux') {
      assert.equal(await protect.isDisabled(), true);
      assert.equal(await login.isDisabled(), true);
      assert.match(await ctx.manager.locator('#modalBody').textContent(), /Not available on Linux/);
      assert.ok((await protectedNow()).every((v) => v === false));
      return;
    }
    assert.equal(await protect.isChecked(), true);
    assert.ok((await protectedNow()).every((v) => v === true));
    await protect.uncheck();
    await ctx.manager.click('#modalFooter .primary-btn');
    await waitForStore(ctx.dataFile, (s) => s.settings.contentProtection === false, 'setting on disk');
    await waitFor(async () => (await protectedNow()).every((v) => v === false), 'protection removed');
  });
});
