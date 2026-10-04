'use strict';

const path = require('path');
const { BrowserWindow, nativeTheme } = require('electron');
const { applyContentProtection, isMac } = require('./platform');

class ManagerWindowController {
  constructor({ attachShortcuts, isContentProtected, onClosed }) {
    this.attachShortcuts = attachShortcuts || (() => {});
    this.isContentProtected = isContentProtected || (() => true);
    this.onClosed = onClosed || (() => {});
    this.win = null;
    this._loaded = false;
    this._queue = [];
  }

  open() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.show();
      this.win.focus();
      return this.win;
    }

    this.win = new BrowserWindow({
      width: 1040,
      height: 700,
      minWidth: 760,
      minHeight: 500,
      show: false,
      title: 'Ghost Notetaker — Notes Manager',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1017' : '#f5f5f9',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'renderer', 'manager', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    const win = this.win;
    this._loaded = false;

    if (isMac()) {
      try {
        win.setWindowButtonVisibility(true);
      } catch (_) {
        /* ignore */
      }
    }

    applyContentProtection(win, this.isContentProtected());
    win.loadFile(path.join(__dirname, '..', 'renderer', 'manager', 'manager.html'), {
      query: { theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.on('did-finish-load', () => {
      this._loaded = true;
      for (const [channel, payload] of this._queue.splice(0)) {
        win.webContents.send(channel, payload);
      }
    });
    this.attachShortcuts(win);

    win.once('ready-to-show', () => {
      applyContentProtection(win, this.isContentProtected());
      win.show();
    });

    win.on('closed', () => {
      if (this.win === win) {
        this.win = null;
        this._loaded = false;
        this._queue = [];
      }
      this.onClosed();
    });

    return win;
  }

  toggle() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible() && this.win.isFocused()) {
      this.win.hide();
      return;
    }
    this.open();
  }

  refresh() {
    this.send('manager:refresh');
  }

  reapplyContentProtection() {
    if (this.win && !this.win.isDestroyed()) applyContentProtection(this.win, this.isContentProtected());
  }

  /** Send to the manager renderer, queueing until a freshly opened window has loaded. */
  send(channel, payload) {
    if (!this.win || this.win.isDestroyed()) return;
    if (!this._loaded) {
      if (channel !== 'manager:refresh') this._queue.push([channel, payload]);
      return;
    }
    this.win.webContents.send(channel, payload);
  }
}

module.exports = { ManagerWindowController };
