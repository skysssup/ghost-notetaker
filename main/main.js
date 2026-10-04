'use strict';

const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog, clipboard, screen, Menu, BrowserWindow, shell } = require('electron');

const { flushPendingNotes } = require('./persistence');
const { Store, NOTE_COLORS, TEMPLATES, defaultShortcuts } = require('./store');
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
  capabilities,
  applyClickThrough,
  applyLaunchAtLogin,
  getLaunchAtLogin
} = require('./platform');
const { cursorNearbyBounds } = require('./display');
const { normalizeAccelerator, formatAccelerator, SHORTCUT_ACTIONS } = require('./accelerator');
const { ShortcutController } = require('./shortcuts');
const { NoteWindowController } = require('./note-window');
const { ManagerWindowController } = require('./manager-window');
const { createAppTray } = require('./tray');

let store;
let notes;
let manager;
let shortcuts;
let trayApi;
let allowQuit = false;
let quitInProgress = false;

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

function assertFromNote(event, noteId) {
  return assertSenderWindow(event, notes ? notes.get(noteId) : null);
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

/** Every IPC channel only answers windows this app created. */
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    assertSenderIsOneOf(event, ownedWindows());
    return fn(event, ...args);
  });
}

if (process.platform === 'linux') {
  // Chromium's spellchecker on Linux downloads Hunspell dictionaries from
  // Google's servers. Load none so the app never goes online by itself.
  // (macOS and Windows use the operating system's spellchecker.)
  app.on('session-created', (ses) => ses.setSpellCheckerLanguages([]));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  allowQuit = true;
  app.quit();
} else {
  app.on('second-instance', () => {
    if (manager) manager.open();
  });
}

function storePath() {
  return path.join(app.getPath('userData'), 'ghost-notetaker-data.json');
}

function logError(err) {
  console.error(err);
}

/** Tell every window whether the notes file is currently being written. */
function broadcastSaveState(state) {
  for (const win of ownedWindows()) win.webContents.send('app:saveState', state);
}

let refreshTimer = null;
function refreshManagerAndTray() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (manager) manager.refresh();
    if (trayApi) trayApi.rebuild();
  }, 60);
}

function safeFileName(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .slice(0, 80);
  return cleaned || 'note';
}

function setContentProtection(enabled) {
  store.updateSettings({ contentProtection: Boolean(enabled) });
  notes.reapplyContentProtection();
  manager.reapplyContentProtection();
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
  const results = await notes.hideAll();
  refreshManagerAndTray();
  return results;
}

async function showAllNotes() {
  const list = store.listNotes({ workspaceId: store.getActiveWorkspaceId() });
  for (const n of list) {
    store.updateNote(n.id, { visible: true });
    await notes.open(n.id);
  }
  refreshManagerAndTray();
}

function togglePreviewOfFocusedNote() {
  const focused = BrowserWindow.getFocusedWindow();
  if (!focused) return;
  for (const [id, win] of notes.windows) {
    if (win !== focused) continue;
    const note = store.getNote(id);
    if (note) {
      store.updateNote(id, { previewMode: !note.previewMode });
      notes.applyNoteAppearance(id);
      refreshManagerAndTray();
    }
    return;
  }
}

function handleShortcutAction(action) {
  const run = {
    newNote: () => createNote(),
    recoveryNewNote: () => createNote(),
    toggleManager: () => manager.toggle(),
    hideShowAll: () => notes.toggleHideShowAll().then(refreshManagerAndTray),
    toggleClickThrough: () => {
      notes.toggleGlobalClickThrough();
      refreshManagerAndTray();
    },
    togglePreview: togglePreviewOfFocusedNote,
    quickCapture: () => quickCapture()
  }[action];
  if (run) Promise.resolve().then(run).catch(logError);
}

/** Reject a patch that gives an action a binding another action already uses. */
function assertNoShortcutConflict(patch) {
  const merged = { ...defaultShortcuts(), ...store.getSettings().shortcuts, ...patch };
  for (const [id, value] of Object.entries(patch)) {
    const accel = normalizeAccelerator(value);
    if (!accel) continue;
    const other = SHORTCUT_ACTIONS.find(
      (a) => a.id !== id && normalizeAccelerator(merged[a.id]) === accel
    );
    if (other) {
      throw new Error(`${formatAccelerator(accel)} is already used for "${other.label}".`);
    }
  }
}

function applyShortcutBindings(patch) {
  assertNoShortcutConflict(patch);
  store.updateSettings({ shortcuts: patch });
  const list = shortcuts.registerGlobal();
  refreshManagerAndTray();
  return list;
}

function dialogParent(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win && !win.isDestroyed() ? win : undefined;
}

async function flushNoteOrThrow(noteId, action) {
  const result = await notes.flushWindow(notes.get(noteId));
  if (!result.ok) {
    throw new Error(`Could not save the note before ${action}: ${result.message || 'save failed'}`);
  }
}

function registerIpc() {
  handle('store:getBootstrap', () => ({
    colors: NOTE_COLORS,
    templates: Object.values(TEMPLATES).map((t) => ({ id: t.id, label: t.label })),
    settings: store.getSettings(),
    workspaces: store.listWorkspaces(),
    activeWorkspaceId: store.getActiveWorkspaceId(),
    platform: process.platform,
    version: app.getVersion(),
    capabilities: capabilities(),
    dataFile: storePath(),
    saveError: store.getLastSaveError() ? store.getLastSaveError().message : null
  }));

  handle('notes:list', (_e, filter) => {
    const f = filter && typeof filter === 'object' ? filter : {};
    const safe = {};
    if (typeof f.workspaceId === 'string') safe.workspaceId = f.workspaceId;
    if (typeof f.tag === 'string') safe.tag = f.tag.slice(0, 64);
    if (typeof f.query === 'string') safe.query = f.query.slice(0, 200);
    if (f.visible === true || f.visible === false) safe.visible = f.visible;
    if (typeof f.sortBy === 'string') safe.sortBy = f.sortBy;
    return store.listNotes(safe);
  });
  handle('notes:get', (_e, id) => store.getNote(requireId(id, 'noteId')));
  handle('notes:tags', (_e, workspaceId) =>
    store.allTags(typeof workspaceId === 'string' ? workspaceId : undefined)
  );
  handle('notes:recent', (_e, limit) => {
    const n = Number(limit);
    return store.recentNotes(Number.isFinite(n) ? Math.min(24, Math.max(1, n)) : 8);
  });

  handle('notes:create', (_e, options) => createNote(sanitizeCreateOptions(options)));

  handle('notes:update', (e, id, patch) => {
    const noteId = requireId(id, 'noteId');
    const sender = assertFromManagerOrNote(e, noteId);
    if (store.isSaveBlocked()) {
      return { __saveError: 'Store recovery required before saving' };
    }
    const note = store.updateNote(noteId, sanitizeNotePatch(patch));
    if (!note) return { __saveError: 'This note no longer exists' };
    // The note window already shows its own edits; echoing them back could
    // overwrite keystrokes typed while this request was in flight.
    notes.applyNoteAppearance(noteId, { notifyRenderer: sender !== notes.get(noteId) });
    refreshManagerAndTray();
    // Disk write failures are reported separately through 'app:saveState'.
    return note;
  });

  handle('notes:hide', async (e, id) => {
    const noteId = requireId(id, 'noteId');
    assertFromManagerOrNote(e, noteId);
    const result = await notes.hide(noteId);
    refreshManagerAndTray();
    if (!result.ok) {
      throw new Error(`Could not save the note before hiding it: ${result.message || 'save failed'}`);
    }
    return true;
  });

  handle('notes:open', async (_e, id) => {
    const noteId = requireId(id, 'noteId');
    if (!store.getNote(noteId)) return null;
    store.updateNote(noteId, { visible: true });
    await notes.open(noteId);
    refreshManagerAndTray();
    return store.getNote(noteId);
  });

  handle('notes:delete', (_e, id) => {
    const noteId = requireId(id, 'noteId');
    notes.closeAndDestroy(noteId);
    const ok = store.deleteNote(noteId);
    refreshManagerAndTray();
    return ok;
  });

  handle('notes:duplicate', async (_e, id) => {
    const noteId = requireId(id, 'noteId');
    await flushNoteOrThrow(noteId, 'duplicating it');
    const note = store.duplicateNote(noteId);
    if (note) await notes.open(note.id);
    refreshManagerAndTray();
    return note;
  });

  handle('notes:bulkVisible', async (_e, ids, visible) => {
    const list = sanitizeIdList(ids).filter((id) => store.getNote(id));
    const failed = [];
    for (const id of list) {
      if (visible) {
        store.updateNote(id, { visible: true });
        await notes.open(id);
      } else {
        const result = await notes.hide(id);
        if (!result.ok) failed.push(result);
      }
    }
    refreshManagerAndTray();
    if (failed.length) {
      throw new Error(
        `${failed.length} note(s) could not be saved and were left open: ${failed[0].message || 'save failed'}`
      );
    }
    return list.length;
  });

  handle('notes:exportMarkdown', async (e, id) => {
    const noteId = requireId(id, 'noteId');
    await flushNoteOrThrow(noteId, 'exporting it');
    const note = store.getNote(noteId);
    if (!note) throw new Error('Note not found');
    const { filePath, canceled } = await dialog.showSaveDialog(dialogParent(e), {
      title: 'Export note as Markdown',
      defaultPath: path.join(app.getPath('documents'), `${safeFileName(note.title)}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (canceled || !filePath) return null;
    await fs.promises.writeFile(filePath, store.noteToMarkdown(noteId), 'utf8');
    return filePath;
  });

  handle('notes:setClickThrough', (e, id, enabled) => {
    const noteId = requireId(id, 'noteId');
    assertFromNote(e, noteId);
    const note = store.updateNote(noteId, { clickThrough: Boolean(enabled) });
    if (note) notes.applyNoteAppearance(noteId, { notifyRenderer: false });
    refreshManagerAndTray();
    return note;
  });

  handle('notes:chromeHover', (e, id, hovering) => {
    const noteId = requireId(id, 'noteId');
    const win = assertFromNote(e, noteId);
    const note = store.getNote(noteId);
    if (!note) return;
    const ignore = (store.getSettings().globalClickThrough || note.clickThrough) && !hovering;
    applyClickThrough(win, ignore, true);
  });

  handle('workspaces:list', () => store.listWorkspaces());
  handle('workspaces:setActive', (_e, id) => {
    const result = store.setActiveWorkspace(requireId(id, 'workspaceId'));
    refreshManagerAndTray();
    return result;
  });
  handle('workspaces:create', (_e, name) => {
    const ws = store.createWorkspace(String(name || '').slice(0, 80));
    refreshManagerAndTray();
    return ws;
  });
  handle('workspaces:rename', (_e, id, name) => {
    const ws = store.renameWorkspace(requireId(id, 'workspaceId'), String(name || '').slice(0, 80));
    refreshManagerAndTray();
    return ws;
  });
  handle('workspaces:delete', (_e, id) => {
    const workspaceId = requireId(id, 'workspaceId');
    const doomed = store.listNotes({ workspaceId }).map((n) => n.id);
    const ok = store.deleteWorkspace(workspaceId);
    if (ok) doomed.forEach((noteId) => notes.closeAndDestroy(noteId));
    refreshManagerAndTray();
    return ok;
  });

  handle('data:exportAll', async (e) => {
    await flushPendingNotes(notes, store);
    const stamp = new Date().toISOString().slice(0, 10);
    const { filePath, canceled } = await dialog.showSaveDialog(dialogParent(e), {
      title: 'Export all notes',
      defaultPath: path.join(app.getPath('documents'), `ghost-notetaker-backup-${stamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePath) return null;
    const payload = store.exportAll();
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    });
    return { filePath, notes: payload.notes.length, workspaces: payload.workspaces.length };
  });

  handle('data:importAll', async (e, mode) => {
    const importMode = mode === 'replace' ? 'replace' : 'merge';
    const { filePaths, canceled } = await dialog.showOpenDialog(dialogParent(e), {
      title: 'Import notes',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths || !filePaths[0]) return null;
    let raw;
    try {
      raw = JSON.parse(await fs.promises.readFile(filePaths[0], 'utf8'));
    } catch (err) {
      throw new Error(`Could not read that file as a Ghost Notetaker backup: ${err.message || err}`);
    }
    await flushPendingNotes(notes, store);
    const result = store.importAll(raw, importMode);
    if (importMode === 'replace') {
      // Replaced notes arrive hidden so they open under the current protection setting.
      notes.destroyAll();
      await notes.openVisibleNotes();
    }
    refreshManagerAndTray();
    return result;
  });

  handle('settings:update', (_e, patch) => {
    const safe = sanitizeSettingsPatch(patch);
    if (safe.shortcuts) assertNoShortcutConflict(safe.shortcuts);
    if (!capabilities().launchAtLogin) delete safe.launchAtLogin;
    const s = store.updateSettings(safe);
    if (safe.shortcuts) shortcuts.registerGlobal();
    if (Object.prototype.hasOwnProperty.call(safe, 'contentProtection')) {
      setContentProtection(s.contentProtection);
    }
    if (Object.prototype.hasOwnProperty.call(safe, 'launchAtLogin')) {
      applyLaunchAtLogin(s.launchAtLogin);
    }
    if (Object.prototype.hasOwnProperty.call(safe, 'globalClickThrough')) {
      notes.setGlobalClickThrough(s.globalClickThrough);
    }
    refreshManagerAndTray();
    return s;
  });

  handle('shortcuts:list', () => shortcuts.listDefinitions());
  handle('shortcuts:set', (_e, id, accelerator) => {
    if (!SHORTCUT_ACTIONS.some((a) => a.id === id)) throw new Error('Unknown shortcut');
    const accel = normalizeAccelerator(accelerator);
    if (accel === null) {
      throw new Error('Use a letter, number, F-key, Space, or arrow key together with Ctrl, Alt, or Cmd.');
    }
    return applyShortcutBindings({ [id]: accel });
  });
  handle('shortcuts:reset', () => applyShortcutBindings(defaultShortcuts()));
  handle('shortcuts:pause', (_e, paused) => {
    shortcuts.pause(Boolean(paused));
    return true;
  });

  handle('app:revealDataFile', () => {
    shell.showItemInFolder(storePath());
    return true;
  });

  handle('shell:openExternal', async (_e, url) => {
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
}

function welcomeNoteContent() {
  const managerKey = formatAccelerator(store.getSettings().shortcuts.toggleManager);
  const caps = capabilities();
  let protection;
  if (!caps.contentProtection) {
    protection =
      'Screen-capture hiding is **not available on Linux**: notes appear in screenshots, recordings, and screen shares.';
  } else if (isMac()) {
    protection =
      'Notes are hidden from screen capture where macOS allows it. Apps that capture with ScreenCaptureKit can still record them, so test your own call or recording app first.';
  } else {
    protection =
      'Notes are hidden from screen capture on Windows 10 (2004) and later. Test your own call or recording app before relying on it.';
  }
  return [
    '# Welcome',
    '',
    'This note floats above other windows. Hover it to show its controls and drag the top bar to move it.',
    '',
    `- Open the **Notes Manager** from the tray icon${managerKey ? ` or with ${managerKey}` : ''}.`,
    '- **✕** hides a note. Only the Notes Manager deletes notes.',
    '- The eye button switches to the Markdown preview, where these boxes can be ticked:',
    '',
    '- [ ] Move this note somewhere handy',
    '- [ ] Open the Notes Manager',
    '',
    protection,
    ''
  ].join('\n');
}

async function boot() {
  hideDockIcon();
  if (isMac()) {
    // Keep standard Edit shortcuts (copy/paste/undo) without the default View
    // menu's reload and developer tools.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
    );
  } else {
    Menu.setApplicationMenu(null);
  }

  store = new Store(storePath(), { onSaveStateChange: broadcastSaveState });
  store.load();

  const loadError = store.getLoadError();
  if (loadError) {
    const detail = [
      loadError.message || 'The notes file could not be read.',
      loadError.quarantinePath
        ? `The unreadable file was moved to:\n${loadError.quarantinePath}`
        : `The unreadable file could not be moved and is still at:\n${loadError.originalPath}`,
      '',
      'Start with an empty notebook (the unreadable file is kept), or quit without changing anything.'
    ].join('\n');
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Ghost Notetaker — notes file unreadable',
      message: 'Your notes file could not be read',
      detail,
      buttons: ['Start Empty Notebook', 'Quit'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (response !== 0) {
      allowQuit = true;
      app.quit();
      return;
    }
    store.acknowledgeCorruptRecovery();
  }

  if (capabilities().launchAtLogin) {
    if (store.getSettings().launchAtLogin) {
      applyLaunchAtLogin(true);
    } else if (getLaunchAtLogin()) {
      // The OS login item survived from an earlier install; reflect it in settings.
      store.updateSettings({ launchAtLogin: true });
    }
  }

  notes = new NoteWindowController({
    store,
    onChanged: refreshManagerAndTray,
    attachShortcuts: (win) => shortcuts.attachLocal(win)
  });

  manager = new ManagerWindowController({
    attachShortcuts: (win) => shortcuts.attachLocal(win),
    isContentProtected: () => store.getSettings().contentProtection !== false,
    onClosed: () => shortcuts.pause(false)
  });

  shortcuts = new ShortcutController({
    getBindings: () => store.getSettings().shortcuts || {},
    onAction: handleShortcutAction
  });
  shortcuts.registerGlobal();

  const safe = (fn) => (...args) => Promise.resolve().then(() => fn(...args)).catch(logError);
  trayApi = createAppTray({
    getSettings: () => store.getSettings(),
    getRecentNotes: () => store.recentNotes(8),
    getWorkspaces: () => store.listWorkspaces(),
    getActiveWorkspaceId: () => store.getActiveWorkspaceId(),
    setActiveWorkspace: (id) => {
      store.setActiveWorkspace(id);
      refreshManagerAndTray();
    },
    newNote: safe(() => createNote()),
    newNoteFromTemplate: safe((templateId) => createNote({ templateId })),
    quickCapture: safe(quickCapture),
    openNote: safe(async (id) => {
      store.updateNote(id, { visible: true });
      await notes.open(id);
      refreshManagerAndTray();
    }),
    openManager: () => manager.open(),
    openSettings: () => {
      manager.open();
      manager.send('manager:showSettings');
    },
    openShortcuts: () => {
      manager.open();
      manager.send('manager:showShortcuts');
    },
    toggleClickThrough: () => {
      notes.toggleGlobalClickThrough();
      refreshManagerAndTray();
    },
    hideAll: safe(hideAllNotes),
    showAll: safe(showAllNotes),
    toggleContentProtection: () => {
      setContentProtection(store.getSettings().contentProtection === false);
      refreshManagerAndTray();
    },
    quit: () => app.quit()
  });

  registerIpc();

  screen.on('display-removed', () => notes.clampAllToDisplays());
  screen.on('display-metrics-changed', () => notes.clampAllToDisplays());

  if (store.listNotes().length === 0) {
    const welcome = await createNote({
      templateId: 'blank',
      title: 'Ghost Notetaker',
      content: welcomeNoteContent(),
      bounds: cursorNearbyBounds({ width: 400, height: 430 })
    });
    store.updateNote(welcome.id, { previewMode: true });
  } else {
    await notes.openVisibleNotes();
  }
}

if (gotLock) {
  app
    .whenReady()
    .then(boot)
    .catch((err) => {
      console.error('Ghost Notetaker failed to start:', err);
      dialog.showErrorBox(
        'Ghost Notetaker could not start',
        `${err && err.message ? err.message : err}\n\nNotes file: ${storePath()}`
      );
      allowQuit = true;
      app.exit(1);
    });
}

app.on('before-quit', (event) => {
  if (allowQuit) {
    try {
      if (shortcuts) shortcuts.unregisterGlobal();
      if (notes) notes.destroyAll({ persistBounds: Boolean(store) && !store.isSaveBlocked() });
      if (store && !store.isSaveBlocked()) store.flush();
    } catch (err) {
      console.error(err);
    }
    return;
  }
  event.preventDefault();
  if (quitInProgress) return;
  quitInProgress = true;
  (async () => {
    try {
      await flushPendingNotes(notes, store && !store.isSaveBlocked() ? store : null);
    } catch (err) {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Ghost Notetaker',
        message: 'Some changes could not be saved',
        detail: `${err.message || err}\n\nKeep the app open to retry or export your notes, or quit and lose the unsaved changes.`,
        buttons: ['Keep Open', 'Quit Without Saving'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (response === 0) {
        quitInProgress = false;
        return;
      }
    }
    allowQuit = true;
    app.quit();
  })();
});

app.on('window-all-closed', () => {
  /* tray app — stay alive */
});

app.on('activate', () => {
  if (manager) manager.open();
});
