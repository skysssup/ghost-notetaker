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
  noteWindow,
  openWindowIds,
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
    assert.equal(await row(manager, /^Toggle reading mode/).locator('.status').textContent(), 'In notes only');
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

    await manager.click('#btnResetShortcuts');
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
    assert.equal(await manager.isVisible('#settingsView'), true, 'Escape while recording must not leave Settings');
    await manager.keyboard.press('Escape');
    await manager.waitForSelector('#settingsView', { state: 'hidden' });
    await new Promise((r) => setTimeout(r, 400));
    const store = await waitForStore(dataFile, () => true);
    assert.equal(store.settings.shortcuts.hideShowAll, 'CommandOrControl+Shift+H');
  });

  it('preferences set the defaults for new notes', async () => {
    const ctx = await start();
    const { manager, dataFile } = ctx;
    await manager.click('#btnSettings');
    await manager.click('#sColor [data-color="rose"]');
    await manager.locator('#sOpacity').fill('50');
    await manager.fill('#sFont', '20');
    await manager.check('#sMono');
    await manager.waitForSelector('#settingsSaved:not([hidden])');
    await waitForStore(
      dataFile,
      (s) => s.settings.defaultColor === 'rose' && s.settings.defaultFontSize === 20 && s.settings.defaultOpacity === 0.5 && s.settings.defaultMonospace,
      'settings on disk'
    );
    await showNotes(manager);

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
      assert.match(await ctx.manager.locator('#setPrivacy').textContent(), /Not available on Linux/);
      assert.ok((await protectedNow()).every((v) => v === false));
      return;
    }
    assert.equal(await protect.isChecked(), true);
    assert.ok((await protectedNow()).every((v) => v === true));
    await protect.uncheck();
    await waitForStore(ctx.dataFile, (s) => s.settings.contentProtection === false, 'setting on disk');
    await waitFor(async () => (await protectedNow()).every((v) => v === false), 'protection removed');
  });
  it('a global shortcut can be limited to Ghost Notetaker windows', async () => {
    const { app, manager, dataFile } = await start();
    const registered = (accel) => app.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), accel);
    await manager.click('#btnShortcuts');
    await manager.waitForSelector('.shortcut-table tbody tr');
    const newNote = row(manager, /^New note$/);
    const before = await newNote.locator('.status').textContent();

    const chooseScope = async (label) => {
      await newNote.getByRole('button', { name: 'Where New note works' }).click();
      await manager.locator('#menu .menu-item', { hasText: label }).click();
    };
    await chooseScope('In Ghost Notetaker');
    await waitForStore(dataFile, (s) => s.settings.shortcutScopes.newNote === 'app', 'scope on disk');
    await waitFor(async () => (await newNote.locator('.status').textContent()) === 'Only in Ghost Notetaker', 'status');
    assert.equal(await registered('CommandOrControl+Shift+N'), false);

    await chooseScope('Everywhere');
    await waitForStore(dataFile, (s) => s.settings.shortcutScopes.newNote === 'global', 'scope back to everywhere');
    await waitFor(async () => (await newNote.locator('.status').textContent()) === before, 'status restored');
    if (before === 'Works everywhere') assert.equal(await registered('CommandOrControl+Shift+N'), true);
  });

  it('the theme setting switches the Notes Manager between light and dark', async () => {
    const { manager, dataFile } = await start();
    await manager.click('#btnSettings');
    await manager.click('.theme-option[data-theme="light"]');
    await waitFor(async () => (await manager.getAttribute('html', 'data-theme')) === 'light', 'light');
    await waitForStore(dataFile, (s) => s.settings.theme === 'light', 'theme on disk');
    const lightBg = await manager.evaluate(() => getComputedStyle(document.querySelector('.main')).backgroundColor);
    await manager.click('.theme-option[data-theme="dark"]');
    await waitFor(async () => (await manager.getAttribute('html', 'data-theme')) === 'dark', 'dark');
    const darkBg = await manager.evaluate(() => getComputedStyle(document.querySelector('.main')).backgroundColor);
    assert.notEqual(lightBg, darkBg);
    assert.equal(await manager.getAttribute('.theme-option[data-theme="dark"]', 'aria-checked'), 'true');
  });

  it('turning off the formatted view shows notes as Markdown source', async () => {
    const { manager, note, dataFile } = await start();
    await note.waitForSelector('#preview:not(.hidden)');
    await manager.click('#btnSettings');
    await manager.uncheck('#sFormatted');
    await waitForStore(dataFile, (s) => s.settings.formattedWhenIdle === false, 'setting on disk');
    await note.waitForSelector('#editor:not(.hidden)');
    assert.equal(await note.isVisible('#preview'), false);
  });

  it('backs up on demand and restores a backup, with undo', async () => {
    const ctx = await start();
    const { app, manager, dataFile, userDataDir } = ctx;
    await manager.click('#btnSettings');
    await manager.waitForSelector('#backupList li[data-backup]');
    const daily = await manager.locator('#backupList li[data-backup]').count();
    assert.equal(daily, 1, 'the daily backup is made at startup');
    await manager.click('#btnBackupNow');
    await waitFor(async () => (await manager.locator('#backupList li[data-backup]').count()) === 2, 'second backup');
    const fs = require('node:fs');
    const path = require('node:path');
    assert.equal(fs.readdirSync(path.join(userDataDir, 'backups')).length, 2);

    await showNotes(manager);
    const before = new Set(app.windows());
    await manager.click('#btnNewNote');
    await waitFor(() => app.windows().find((w) => !before.has(w) && w.url().includes('note.html')), 'new note');
    await waitForStore(dataFile, (s) => s.notes.length === 2, 'two notes');

    await manager.click('#btnSettings');
    await manager.locator('#backupList li[data-backup]').first().getByRole('button', { name: /Restore/ }).click();
    await manager.click('#modalFooter .danger-btn');
    await waitForStore(dataFile, (s) => s.notes.length === 1 && s.notes.every((n) => !n.visible), 'restored');
    await waitFor(async () => (await openWindowIds(app)).length === 0, 'restored notes start hidden');
    await waitFor(async () => /Restored 1 note/.test(await manager.locator('#toastText').textContent()), 'restore message');
    await manager.click('#toastAction');
    await waitForStore(dataFile, (s) => s.notes.length === 2, 'restore undone');
  });
});
