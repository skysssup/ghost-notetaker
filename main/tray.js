'use strict';

const path = require('path');
const fs = require('fs');
const { Tray, Menu, nativeImage } = require('electron');
const { isMac, acceleratorLabel } = require('./platform');

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

function buildTrayMenu(api) {
  const settings = api.getSettings();
  const clickThrough = settings.globalClickThrough;
  const shortcuts = settings.shortcuts || {};

  return Menu.buildFromTemplate([
    {
      label: 'New Note',
      accelerator: shortcuts.newNote,
      click: () => api.newNote()
    },
    {
      label: 'Quick Capture (clipboard)',
      accelerator: shortcuts.quickCapture,
      click: () => api.quickCapture()
    },
    { type: 'separator' },
    {
      label: 'Notes Manager…',
      accelerator: shortcuts.toggleManager,
      click: () => api.openManager()
    },
    {
      label: clickThrough ? 'Disable Click-Through' : 'Enable Click-Through',
      accelerator: shortcuts.toggleClickThrough,
      click: () => api.toggleClickThrough()
    },
    {
      label: 'Hide / Show All Notes',
      accelerator: shortcuts.hideShowAll,
      click: () => api.toggleHideShow()
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
