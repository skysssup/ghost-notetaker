'use strict';

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');
const { isMac, capabilities } = require('./platform');
const { TEMPLATES } = require('./store');

function createTrayImage() {
  // macOS menu-bar icons are template images: black shapes the system tints.
  // Other platforms get the colored icon.
  const file = isMac() ? 'trayTemplate.png' : 'tray-icon.png';
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'build', file));
  if (isMac()) img.setTemplateImage(true);
  return img;
}

function truncate(s, n) {
  const t = String(s || 'Untitled').trim() || 'Untitled';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function buildTrayMenu(api) {
  const settings = api.getSettings();
  const clickThrough = settings.globalClickThrough;
  const shortcuts = settings.shortcuts || {};
  const protectionAvailable = capabilities().contentProtection;
  const contentProtection = settings.contentProtection !== false;
  const recent = api.getRecentNotes();
  const workspaces = api.getWorkspaces();
  const activeWs = api.getActiveWorkspaceId();

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

  const workspaceItems = workspaces.map((ws) => ({
    label: ws.name,
    type: 'radio',
    checked: ws.id === activeWs,
    click: () => api.setActiveWorkspace(ws.id)
  }));

  return Menu.buildFromTemplate([
    {
      label: 'New Note',
      accelerator: shortcuts.newNote || undefined,
      click: () => api.newNote()
    },
    {
      label: 'New from Template',
      submenu: templateItems
    },
    {
      label: 'Quick Capture (clipboard)',
      accelerator: shortcuts.quickCapture || undefined,
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
      accelerator: shortcuts.toggleManager || undefined,
      click: () => api.openManager()
    },
    {
      label: 'Settings…',
      click: () => api.openSettings()
    },
    { type: 'separator' },
    {
      label: clickThrough ? 'Disable Click-Through' : 'Enable Click-Through',
      accelerator: shortcuts.toggleClickThrough || undefined,
      click: () => api.toggleClickThrough()
    },
    {
      label: 'Hide All Notes',
      accelerator: shortcuts.hideShowAll || undefined,
      click: () => api.hideAll()
    },
    {
      label: 'Show All Notes',
      click: () => api.showAll()
    },
    protectionAvailable
      ? {
          label: 'Hide from Screen Capture',
          type: 'checkbox',
          checked: contentProtection,
          click: () => api.toggleContentProtection()
        }
      : { label: 'Screen-capture hiding: not available on Linux', enabled: false },
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
    if (process.platform === 'win32' || process.platform === 'linux') api.openManager();
  });
  tray.on('double-click', () => api.openManager());
  return { tray, rebuild };
}

module.exports = { createAppTray };
