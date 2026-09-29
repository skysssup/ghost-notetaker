'use strict';

const path = require('path');
const { BrowserWindow } = require('electron');
const { applyContentProtection, isMac } = require('./platform');

class ManagerWindowController {
  constructor({ attachShortcuts }) {
    this.attachShortcuts = attachShortcuts || (() => {});
    this.win = null;
  }

  open() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      return this.win;
    }

    this.win = new BrowserWindow({
      width: 920,
      height: 640,
      minWidth: 720,
      minHeight: 480,
      show: false,
      title: 'Ghost Notetaker — Notes Manager',
      backgroundColor: '#1a1d27',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'renderer', 'manager', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    if (isMac()) {
      try {
        this.win.setWindowButtonVisibility(true);
      } catch (_) {
        /* ignore */
      }
    }

    applyContentProtection(this.win, true);
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'manager', 'manager.html'));
    this.attachShortcuts(this.win);

    this.win.once('ready-to-show', () => {
      applyContentProtection(this.win, true);
      this.win.show();
    });

    this.win.on('closed', () => {
      this.win = null;
    });

    return this.win;
  }

  toggle() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.win.hide();
      return;
    }
    this.open();
  }

  refresh() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('manager:refresh');
    }
  }

  send(channel, payload) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(channel, payload);
    }
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }
    this.win = null;
  }
}

module.exports = { ManagerWindowController };
