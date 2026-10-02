'use strict';

const path = require('path');
const { app, ipcMain, dialog, clipboard, screen, Menu, BrowserWindow, shell } = require('electron');

const { flushPendingNotes } = require('./persistence');
const { Store, NOTE_COLORS, TEMPLATES } = require('./store');
const {
  requireId,
  sanitizeNotePatch,
  sanitizeCreateOptions,
  sanitizeSettingsPatch,
  sanitizeIdList,
  assertSenderWindow,
  assertSenderIsOneOf
} = require('./ipc-guards');
const {
  hideDockIcon,
  isMac,
  applyLaunchAtLogin,
  getLaunchAtLogin
} = require('./platform');
const { cursorNearbyBounds } = require('./display');
const { ShortcutController } = require('./shortcuts');
const { NoteWindowController } = require('./note-window');
const { ManagerWindowController } = require('./manager-window');
const { createAppTray } = require('./tray');

let store;
let notes;
let manager;
let shortcuts;
let trayApi;
let quitting = false;
let allowQuit = false;

function ownedWindows() {
  const list = [];
  if (manager && manager.win && !manager.win.isDestroyed()) list.push(manager.win);
  if (notes) {
    for (const win of notes.windows.values()) {
      if (win && !win.isDestroyed()) list.push(win);
    }
  }
  return list;
}

function assertFromApp(event) {
  return assertSenderIsOneOf(event, ownedWindows());
}

function assertFromNote(event, noteId) {
  const win = notes ? notes.get(noteId) : null;
  return assertSenderWindow(event, win);
}

function assertFromManagerOrNote(event, noteId) {
  const noteWin = notes ? notes.get(noteId) : null;
  if (noteWin && !noteWin.isDestroyed() && event.sender === noteWin.webContents) {
    return noteWin;
  }
  if (manager && manager.win && !manager.win.isDestroyed() && event.sender === manager.win.webContents) {
    return manager.win;
  }
  throw new Error('Unauthorized IPC sender');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (manager) manager.open();
  });
}

function storePath() {
  return path.join(app.getPath('userData'), 'ghost-notetaker-data.json');
}

function refreshManagerAndTray() {
  if (manager) manager.refresh();
  if (trayApi) trayApi.rebuild();
}

function syncLoginItem(enabled) {
  applyLaunchAtLogin(Boolean(enabled));
}

async function createNote(options = {}) {
  const bounds = options.bounds || cursorNearbyBounds();
  const note = store.createNote({
    ...options,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    },
    displayId: bounds.displayId,
    visible: true
  });
  await notes.open(note.id);
  refreshManagerAndTray();
  return note;
}

async function quickCapture() {
  let text = '';
  try {
    text = clipboard.readText() || '';
  } catch (_) {
    text = '';
  }
  return createNote({
    title: 'Quick capture',
    content: text,
    templateId: 'blank'
  });
}

async function hideAllNotes() {
  notes.hideAll();
  refreshManagerAndTray();
}

async function showAllNotes() {
  const list = store.listNotes({ workspaceId: store.getActiveWorkspaceId() });
  for (const n of list) {
    store.updateNote(n.id, { visible: true });
    await notes.open(n.id);
  }
  refreshManagerAndTray();
}

function handleShortcutAction(action) {
  switch (action) {
    case 'newNote':
    case 'recoveryNewNote':
      createNote();
      break;
    case 'toggleManager':
      manager.toggle();
      break;
    case 'hideShowAll':
      notes.toggleHideShowAll().then(() => refreshManagerAndTray());
      break;
    case 'toggleClickThrough':
      notes.toggleGlobalClickThrough();
      refreshManagerAndTray();
      break;
    case 'togglePreview': {
      const focused = BrowserWindow.getFocusedWindow();
      if (!focused) break;
      for (const [id, win] of notes.windows) {
        if (win === focused) {
          const note = store.getNote(id);
          if (note) {
            store.updateNote(id, { previewMode: !note.previewMode });
            notes.applyNoteAppearance(id);
            refreshManagerAndTray();
          }
          break;
        }
      }
      break;
    }
    case 'quickCapture':
      quickCapture();
      break;
    default:
      break;
  }
}

function registerIpc() {
  ipcMain.handle('store:getBootstrap', () => {
    return {
      colors: NOTE_COLORS,
      templates: Object.values(TEMPLATES).map((t) => ({
        id: t.id,
        label: t.label
      })),
      settings: store.getSettings(),
      workspaces: store.listWorkspaces(),
      activeWorkspaceId: store.getActiveWorkspaceId(),
      platform: process.platform,
      version: app.getVersion(),
      launchAtLoginSupported: typeof app.setLoginItemSettings === 'function'
    };
  });

  ipcMain.handle('notes:list', (_e, filter) => {
    const f = filter && typeof filter === 'object' ? filter : {};
    const safe = {};
    if (typeof f.workspaceId === 'string') safe.workspaceId = f.workspaceId;
    if (typeof f.tag === 'string') safe.tag = f.tag.slice(0, 64);
    if (typeof f.query === 'string') safe.query = f.query.slice(0, 200);
    if (f.visible === true || f.visible === false) safe.visible = f.visible;
    if (typeof f.sortBy === 'string') safe.sortBy = f.sortBy;
    return store.listNotes(safe);
  });
  ipcMain.handle('notes:get', (_e, id) => store.getNote(requireId(id, 'noteId')));
  ipcMain.handle('notes:tags', (_e, workspaceId) =>
    store.allTags(typeof workspaceId === 'string' ? workspaceId : undefined)
  );
  ipcMain.handle('notes:recent', (_e, limit) => {
    const n = Number(limit);
    return store.recentNotes(Number.isFinite(n) ? Math.min(24, Math.max(1, n)) : 8);
  });

  ipcMain.handle('notes:create', async (e, options) => {
    assertFromApp(e);
    const note = await createNote(sanitizeCreateOptions(options));
    return note;
  });

  ipcMain.handle('notes:update', (e, id, patch) => {
    const noteId = requireId(id, 'noteId');
    assertFromManagerOrNote(e, noteId);
    if (store.isSaveBlocked && store.isSaveBlocked()) {
      return { __saveError: 'Store recovery required before saving' };
    }
    try {
      const note = store.updateNote(noteId, sanitizeNotePatch(patch));
      if (note) {
        notes.applyNoteAppearance(noteId);
        refreshManagerAndTray();
      }
      const saveErr = store.getLastSaveError && store.getLastSaveError();
      if (saveErr) {
        return { ...(note || {}), __saveError: saveErr.message || String(saveErr) };
      }
      return note;
    } catch (err) {
      return { __saveError: err && err.message ? err.message : String(err) };
    }
  });

  ipcMain.handle('notes:hide', (e, id) => {
    const noteId = requireId(id, 'noteId');
    assertFromManagerOrNote(e, noteId);
    notes.hide(noteId);
    refreshManagerAndTray();
    return true;
  });

  ipcMain.handle('notes:open', async (e, id) => {
    assertFromApp(e);
    const noteId = requireId(id, 'noteId');
    store.updateNote(noteId, { visible: true });
    await notes.open(noteId);
    refreshManagerAndTray();
    return store.getNote(noteId);
  });

  ipcMain.handle('notes:delete', async (e, id) => {
    assertFromApp(e);
    const noteId = requireId(id, 'noteId');
    notes.closeAndDestroy(noteId);
    const ok = store.deleteNote(noteId);
    refreshManagerAndTray();
    return ok;
  });

  ipcMain.handle('notes:duplicate', async (_e, id) => {
    const note = store.duplicateNote(requireId(id, 'noteId'));
    if (note) {
      await notes.open(note.id);
      refreshManagerAndTray();
    }
    return note;
  });

  ipcMain.handle('notes:bulkVisible', async (_e, ids, visible) => {
    const list = sanitizeIdList(ids);
    const show = Boolean(visible);
    for (const id of list) {
      if (show) {
        store.updateNote(id, { visible: true });
        await notes.open(id);
      } else {
        notes.hide(id);
      }
    }
    refreshManagerAndTray();
    return list.length;
  });

  ipcMain.handle('notes:exportMarkdown', async (_e, id) => {
    const noteId = requireId(id, 'noteId');
    const md = store.noteToMarkdown(noteId);
    if (!md) return null;
    const note = store.getNote(noteId);
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export note as Markdown',
      defaultPath: `${(note && note.title) || 'note'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (canceled || !filePath) return null;
    require('fs').writeFileSync(filePath, md, 'utf8');
    return filePath;
  });

  ipcMain.handle('notes:setClickThrough', (e, id, enabled) => {
    const noteId = requireId(id, 'noteId');
    assertFromNote(e, noteId);
    const note = store.updateNote(noteId, { clickThrough: Boolean(enabled) });
    if (note) notes.applyNoteAppearance(noteId);
    return note;
  });

  ipcMain.handle('notes:chromeHover', (e, id, hovering) => {
    const noteId = requireId(id, 'noteId');
    assertFromNote(e, noteId);
    const win = notes.get(noteId);
    const note = store.getNote(noteId);
    if (!win || !note) return;
    const global = store.getSettings().globalClickThrough;
    const shouldIgnore = (global || note.clickThrough) && !hovering;
    const { applyClickThrough } = require('./platform');
    applyClickThrough(win, shouldIgnore, true);
  });

  ipcMain.handle('workspaces:list', () => store.listWorkspaces());
  ipcMain.handle('workspaces:active', () => store.getActiveWorkspaceId());
  ipcMain.handle('workspaces:setActive', (_e, id) => {
    const result = store.setActiveWorkspace(requireId(id, 'workspaceId'));
    refreshManagerAndTray();
    return result;
  });
  ipcMain.handle('workspaces:create', (_e, name) => {
    const ws = store.createWorkspace(String(name || '').slice(0, 80));
    refreshManagerAndTray();
    return ws;
  });
  ipcMain.handle('workspaces:rename', (_e, id, name) => {
    const ws = store.renameWorkspace(requireId(id, 'workspaceId'), String(name || '').slice(0, 80));
    refreshManagerAndTray();
    return ws;
  });
  ipcMain.handle('workspaces:delete', (_e, id) => {
    const ok = store.deleteWorkspace(requireId(id, 'workspaceId'));
    for (const n of [...notes.listOpenIds()]) {
      if (!store.getNote(n)) notes.closeAndDestroy(n);
    }
    refreshManagerAndTray();
    return ok;
  });

  ipcMain.handle('data:exportAll', async (e) => {
    assertFromApp(e);
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export all notes',
      defaultPath: `ghost-notetaker-backup-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePath) return null;
    await flushPendingNotes(notes, store);
    const payload = store.exportAll();
    require('fs').writeFileSync(filePath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    return filePath;
  });

  ipcMain.handle('data:importAll', async (e, mode) => {
    assertFromApp(e);
    const importMode = mode === 'replace' ? 'replace' : 'merge';
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Import notes',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths || !filePaths[0]) return null;
    let raw;
    try {
      raw = JSON.parse(require('fs').readFileSync(filePaths[0], 'utf8'));
    } catch (err) {
      throw new Error(
        `Could not parse import file: ${err && err.message ? err.message : String(err)}`
      );
    }
    await flushPendingNotes(notes, store);
    let result;
    try {
      result = store.importAll(raw, importMode);
    } catch (err) {
      throw new Error(err && err.message ? err.message : String(err));
    }
    if (importMode === 'replace') {
      notes.destroyAll();
      // Notes are forced hidden on replace; do not reopen under imported protection settings.
      await notes.openVisibleNotes();
    }
    refreshManagerAndTray();
    return result;
  });

  ipcMain.handle('store:getLoadError', (e) => {
    assertFromApp(e);
    return store.getLoadError ? store.getLoadError() : null;
  });

  ipcMain.handle('store:acknowledgeCorruptRecovery', (e) => {
    assertFromApp(e);
    if (!store.acknowledgeCorruptRecovery) return null;
    const state = store.acknowledgeCorruptRecovery();
    refreshManagerAndTray();
    return {
      ok: true,
      workspaces: state.workspaces.length,
      notes: state.notes.length
    };
  });

  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:update', (e, patch) => {
    assertFromApp(e);
    const safe = sanitizeSettingsPatch(patch);
    const s = store.updateSettings(safe);
    if (safe.shortcuts) shortcuts.registerGlobal();
    if (Object.prototype.hasOwnProperty.call(safe, 'contentProtection')) {
      notes.reapplyContentProtection();
    }
    if (Object.prototype.hasOwnProperty.call(safe, 'launchAtLogin')) {
      syncLoginItem(s.launchAtLogin);
    }
    if (Object.prototype.hasOwnProperty.call(safe, 'globalClickThrough')) {
      notes.setGlobalClickThrough(s.globalClickThrough);
    }
    refreshManagerAndTray();
    return s;
  });

  ipcMain.handle('shortcuts:list', () => shortcuts.listDefinitions());

  ipcMain.handle('shell:openExternal', async (e, url) => {
    assertFromApp(e);
    if (typeof url !== 'string' || url.length > 2048) return false;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    await shell.openExternal(parsed.toString());
    return true;
  });

  ipcMain.handle('app:quit', () => {
    quitting = true;
    app.quit();
  });

}

async function boot() {
  hideDockIcon();

  store = new Store(storePath());
  store.load();

  if (store.getLoadError && store.getLoadError()) {
    const info = store.getLoadError();
    const detail = [
      info.message || 'The notes file could not be read.',
      info.quarantinePath
        ? `Original file quarantined at:\n${info.quarantinePath}`
        : 'The original file was left in place because it could not be moved.',
      '',
      'Choose Recover to start with an empty notebook (explicit).',
      'Choose Quit to exit without writing a new store file.'
    ].join('\n');
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Ghost Notetaker — store recovery',
      message: 'Notes data looks corrupt',
      detail,
      buttons: ['Recover empty notebook', 'Quit'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (response !== 0) {
      allowQuit = true;
      quitting = true;
      app.quit();
      return;
    }
    store.acknowledgeCorruptRecovery();
  }

  // Reconcile launch-at-login with OS
  const settings = store.getSettings();
  if (settings.launchAtLogin) {
    syncLoginItem(true);
  } else if (getLaunchAtLogin()) {
    // Keep store in sync if OS already has it enabled from a prior install
    store.updateSettings({ launchAtLogin: true });
  }

  notes = new NoteWindowController({
    store,
    onChanged: refreshManagerAndTray,
    attachShortcuts: (win) => shortcuts.attachLocal(win)
  });

  manager = new ManagerWindowController({
    attachShortcuts: (win) => shortcuts.attachLocal(win)
  });

  shortcuts = new ShortcutController({
    getBindings: () => store.getSettings().shortcuts || {},
    onAction: handleShortcutAction
  });
  shortcuts.registerGlobal();

  trayApi = createAppTray({
    getSettings: () => store.getSettings(),
    getRecentNotes: () => store.recentNotes(8),
    getWorkspaces: () => store.listWorkspaces(),
    getActiveWorkspaceId: () => store.getActiveWorkspaceId(),
    setActiveWorkspace: (id) => {
      store.setActiveWorkspace(id);
      refreshManagerAndTray();
    },
    newNote: () => createNote(),
    newNoteFromTemplate: (templateId) => createNote({ templateId }),
    quickCapture: () => quickCapture(),
    openNote: async (id) => {
      store.updateNote(id, { visible: true });
      await notes.open(id);
      refreshManagerAndTray();
    },
    openManager: () => manager.open(),
    openSettings: () => {
      manager.open();
      setTimeout(() => manager.send('manager:showSettings'), 200);
    },
    toggleClickThrough: () => {
      notes.toggleGlobalClickThrough();
      refreshManagerAndTray();
    },
    toggleHideShow: () => notes.toggleHideShowAll().then(() => refreshManagerAndTray()),
    hideAll: () => hideAllNotes(),
    showAll: () => showAllNotes(),
    toggleContentProtection: () => {
      const cur = store.getSettings().contentProtection !== false;
      store.updateSettings({ contentProtection: !cur });
      notes.reapplyContentProtection();
      refreshManagerAndTray();
    },
    openShortcuts: () => {
      manager.open();
      setTimeout(() => manager.send('manager:showShortcuts'), 200);
    },
    quit: () => {
      quitting = true;
      app.quit();
    }
  });

  registerIpc();

  screen.on('display-removed', () => notes.clampAllToDisplays());
  screen.on('display-metrics-changed', () => notes.clampAllToDisplays());

  const visible = store.listNotes().filter((n) => n.visible);
  if (visible.length === 0 && store.listNotes().length === 0) {
    await createNote({ templateId: 'blank', title: 'Ghost' });
    const first = store.listNotes()[0];
    if (first) {
      store.updateNote(first.id, {
        content: [
          '# Ghost',
          '',
          'Best-effort hide from screen capture (not guaranteed). Hover the top bar for controls.',
          '',
          'Tray → Notes Manager for search, workspaces, prefs.',
          'Close hides. Delete only from the manager.',
          ''
        ].join('\n')
      });
      notes.applyNoteAppearance(first.id);
    }
  } else {
    await notes.openVisibleNotes();
  }

  if (!isMac()) {
    Menu.setApplicationMenu(null);
  }
}

app
  .whenReady()
  .then(boot)
  .catch((err) => {
    console.error('Ghost Notetaker failed to start:', err);
  });

app.on('before-quit', (event) => {
  if (allowQuit) {
    quitting = true;
    try {
      if (shortcuts) shortcuts.unregisterGlobal();
      if (notes) notes.destroyAll();
    } catch (err) {
      console.error(err);
    }
    return;
  }
  event.preventDefault();
  quitting = true;
  (async () => {
    try {
      await flushPendingNotes(notes, store && !store.isSaveBlocked() ? store : null);
      if (shortcuts) shortcuts.unregisterGlobal();
      if (notes) notes.destroyAll();
      allowQuit = true;
      app.quit();
    } catch (err) {
      quitting = false;
      console.error(err);
      dialog.showErrorBox('Notes could not be saved', `${err.message || err}. The app remains open so you can retry or export your notes.`);
    }
  })();
});

app.on('window-all-closed', () => {
  /* tray app — stay alive */
});

app.on('activate', () => {
  if (manager) manager.open();
});
