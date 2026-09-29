'use strict';

const path = require('path');
const fs = require('fs');
const { Tray, Menu, nativeImage } = require('electron');
const { isMac, acceleratorLabel } = require('./platform');
const { TEMPLATES } = require('./store');

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAANElEQVQ4T2NkYGD4z0ABYBzVMKoBBgYGBhBmZGRk/A8CDAwMjP8ZGRn/jwIYGBj+MzIy/h8FMDAwMAAAtW4E/0bV7y8AAAAASUVORK5CYII=';

function createTrayImage() {
  const file = path.join(__dirname, '..', 'build', 'tray-icon.png');
  if (fs.existsSync(file)) {
    let img = nativeImage.createFromPath(file);
    if (!img.isEmpty()) {
      if (isMac()) img.setTemplateImage(true);
      return img;
    }
  }
  return nativeImage.createFromDataURL(TINY_PNG);
}

function truncate(s, n) {
  const t = String(s || 'Untitled').trim() || 'Untitled';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function buildTrayMenu(api) {
  const settings = api.getSettings();
  const clickThrough = settings.globalClickThrough;
  const shortcuts = settings.shortcuts || {};
  const contentProtection = settings.contentProtection !== false;
  const recent = typeof api.getRecentNotes === 'function' ? api.getRecentNotes() : [];
  const workspaces = typeof api.getWorkspaces === 'function' ? api.getWorkspaces() : [];
  const activeWs = typeof api.getActiveWorkspaceId === 'function' ? api.getActiveWorkspaceId() : null;

  const templateItems = Object.values(TEMPLATES).map((t) => ({
    label: t.label,
    click: () => api.newNoteFromTemplate(t.id)
  }));

  const recentItems =
    recent.length === 0
      ? [{ label: 'No recent notes', enabled: false }]
      : recent.map((n) => ({
          label: truncate(n.title, 36),
          click: () => api.openNote(n.id)
        }));

  const workspaceItems =
    workspaces.length === 0
      ? [{ label: 'No workspaces', enabled: false }]
      : workspaces.map((ws) => ({
          label: ws.name,
          type: 'radio',
          checked: ws.id === activeWs,
          click: () => api.setActiveWorkspace(ws.id)
        }));

  return Menu.buildFromTemplate([
    {
      label: 'New Note',
      accelerator: shortcuts.newNote,
      click: () => api.newNote()
    },
    {
      label: 'New from Template',
      submenu: templateItems
    },
    {
      label: 'Quick Capture (clipboard)',
      accelerator: shortcuts.quickCapture,
      click: () => api.quickCapture()
    },
    { type: 'separator' },
    {
      label: 'Recent Notes',
      submenu: recentItems
    },
    {
      label: 'Workspace',
      submenu: [
        ...workspaceItems,
        { type: 'separator' },
        { label: 'Manage Workspaces…', click: () => api.openManager() }
      ]
    },
    { type: 'separator' },
    {
      label: 'Notes Manager…',
      accelerator: shortcuts.toggleManager,
      click: () => api.openManager()
    },
    {
      label: 'Preferences…',
      click: () => api.openSettings()
    },
    { type: 'separator' },
    {
      label: clickThrough ? 'Disable Click-Through' : 'Enable Click-Through',
      accelerator: shortcuts.toggleClickThrough,
      click: () => api.toggleClickThrough()
    },
    {
      label: 'Hide All Notes',
      accelerator: shortcuts.hideShowAll,
      click: () => api.hideAll()
    },
    {
      label: 'Show All Notes',
      click: () => api.showAll()
    },
    {
      label: contentProtection ? 'Content Protection: On' : 'Content Protection: Off',
      type: 'checkbox',
      checked: contentProtection,
      click: () => api.toggleContentProtection()
    },
    { type: 'separator' },
    {
      label: 'Keyboard Shortcuts…',
      click: () => api.openShortcuts()
    },
    { type: 'separator' },
    {
      label: 'Quit Ghost Notetaker',
      click: () => api.quit()
    }
  ]);
}

function createAppTray(api) {
  const tray = new Tray(createTrayImage());
  tray.setToolTip('Ghost Notetaker');
  const rebuild = () => tray.setContextMenu(buildTrayMenu(api));
  rebuild();
  tray.on('click', () => {
    if (process.platform === 'win32' || process.platform === 'linux') {
      api.openManager();
    }
  });
  tray.on('double-click', () => api.openManager());
  return { tray, rebuild };
}

module.exports = {
  createAppTray,
  buildTrayMenu,
  acceleratorLabel
};
