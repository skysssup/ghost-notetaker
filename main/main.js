'use strict';

const path = require('path');
const { app, ipcMain, dialog, clipboard, screen, Menu, BrowserWindow } = require('electron');

const { Store, NOTE_COLORS, TEMPLATES } = require('./store');
const { hideDockIcon, isMac } = require('./platform');
const { cursorNearbyBounds, clampBoundsToDisplays } = require('./display');
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
      platform: process.platform
    };
  });

  ipcMain.handle('notes:list', (_e, filter) => store.listNotes(filter || {}));
  ipcMain.handle('notes:get', (_e, id) => store.getNote(id));
  ipcMain.handle('notes:tags', (_e, workspaceId) => store.allTags(workspaceId));

  ipcMain.handle('notes:create', async (_e, options) => {
    const note = await createNote(options || {});
    return note;
  });

  ipcMain.handle('notes:update', (_e, id, patch) => {
    const note = store.updateNote(id, patch || {});
    if (note) {
      notes.applyNoteAppearance(id);
      refreshManagerAndTray();
    }
    return note;
  });

  ipcMain.handle('notes:hide', (_e, id) => {
    notes.hide(id);
    refreshManagerAndTray();
    return true;
  });

  ipcMain.handle('notes:open', async (_e, id) => {
    store.updateNote(id, { visible: true });
    await notes.open(id);
    refreshManagerAndTray();
    return store.getNote(id);
  });

  ipcMain.handle('notes:delete', async (_e, id) => {
    notes.closeAndDestroy(id);
    const ok = store.deleteNote(id);
    refreshManagerAndTray();
    return ok;
  });

  ipcMain.handle('notes:exportMarkdown', async (_e, id) => {
    const md = store.noteToMarkdown(id);
    if (!md) return null;
    const note = store.getNote(id);
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export note as Markdown',
      defaultPath: `${(note && note.title) || 'note'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (canceled || !filePath) return null;
    require('fs').writeFileSync(filePath, md, 'utf8');
    return filePath;
  });

  ipcMain.handle('notes:setClickThrough', (_e, id, enabled) => {
    const note = store.updateNote(id, { clickThrough: Boolean(enabled) });
    if (note) notes.applyNoteAppearance(id);
    return note;
  });

  ipcMain.handle('notes:chromeHover', (_e, id, hovering) => {
    const win = notes.get(id);
    const note = store.getNote(id);
    if (!win || !note) return;
    const global = store.getSettings().globalClickThrough;
    const shouldIgnore = (global || note.clickThrough) && !hovering;
    const { applyClickThrough } = require('./platform');
    applyClickThrough(win, shouldIgnore, true);
  });

  ipcMain.handle('workspaces:list', () => store.listWorkspaces());
  ipcMain.handle('workspaces:active', () => store.getActiveWorkspaceId());
  ipcMain.handle('workspaces:setActive', (_e, id) => {
    const result = store.setActiveWorkspace(id);
    refreshManagerAndTray();
    return result;
  });
  ipcMain.handle('workspaces:create', (_e, name) => {
    const ws = store.createWorkspace(name);
    refreshManagerAndTray();
    return ws;
  });
  ipcMain.handle('workspaces:rename', (_e, id, name) => {
    const ws = store.renameWorkspace(id, name);
    refreshManagerAndTray();
    return ws;
  });
  ipcMain.handle('workspaces:delete', (_e, id) => {
    const ok = store.deleteWorkspace(id);
    // Close windows for deleted notes
    for (const n of [...notes.listOpenIds()]) {
      if (!store.getNote(n)) notes.closeAndDestroy(n);
    }
    refreshManagerAndTray();
    return ok;
  });

  ipcMain.handle('data:exportAll', async () => {
    const payload = store.exportAll();
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export all notes',
      defaultPath: `ghost-notetaker-backup-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (canceled || !filePath) return null;
    require('fs').writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return filePath;
  });

  ipcMain.handle('data:importAll', async (_e, mode) => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Import notes',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths || !filePaths[0]) return null;
    const raw = JSON.parse(require('fs').readFileSync(filePaths[0], 'utf8'));
    const result = store.importAll(raw, mode === 'replace' ? 'replace' : 'merge');
    if (mode === 'replace') {
      notes.destroyAll();
      await notes.openVisibleNotes();
    }
    refreshManagerAndTray();
    return result;
  });

  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:update', (_e, patch) => {
    const s = store.updateSettings(patch || {});
    if (patch && patch.shortcuts) shortcuts.registerGlobal();
    refreshManagerAndTray();
    return s;
  });

  ipcMain.handle('shortcuts:list', () => shortcuts.listDefinitions());

  ipcMain.handle('app:quit', () => {
    quitting = true;
    app.quit();
  });

  ipcMain.on('note:drag-start', () => {
    /* reserved for future drag affordances */
  });
}

async function boot() {
  hideDockIcon();

  store = new Store(storePath());
  store.load();

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
    newNote: () => createNote(),
    quickCapture: () => quickCapture(),
    openManager: () => manager.open(),
    toggleClickThrough: () => {
      notes.toggleGlobalClickThrough();
      refreshManagerAndTray();
    },
    toggleHideShow: () => notes.toggleHideShowAll().then(() => refreshManagerAndTray()),
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
    await createNote({ templateId: 'blank', title: 'Welcome to Ghost Notetaker' });
    const welcome = store.listNotes()[0];
    if (welcome) {
      store.updateNote(welcome.id, {
        content: [
          '# Ghost Notetaker',
          '',
          'Translucent notes that stay **invisible** to screen sharing.',
          '',
          '- Hover the top edge to reveal controls',
          '- Toggle markdown preview with the eye icon',
          '- Open the **Notes Manager** from the tray',
          '- Try a template when creating a note',
          '',
          '## Checklist',
          '- [ ] Create a meeting note',
          '- [ ] Add a tag',
          '- [ ] Export a backup',
          ''
        ].join('\n')
      });
      notes.applyNoteAppearance(welcome.id);
    }
  } else {
    await notes.openVisibleNotes();
  }

  // Empty application menu so accelerators don't conflict oddly on Linux
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

app.on('before-quit', () => {
  quitting = true;
  try {
    if (shortcuts) shortcuts.unregisterGlobal();
    if (store) store.flush();
    if (notes) notes.destroyAll();
  } catch (err) {
    console.error(err);
  }
});

app.on('window-all-closed', (e) => {
  // Tray app — stay alive
  if (!quitting) {
    /* keep running */
  }
});

app.on('activate', () => {
  if (manager) manager.open();
});
