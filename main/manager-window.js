'use strict';

const os = require('os');
const path = require('path');
const { BrowserWindow, nativeTheme } = require('electron');
const { applyContentProtection, isMac, isWin } = require('./platform');

/** Canvas and text colors from renderer/shared/tokens.css, for the parts of the window the OS draws. */
const CHROME = {
  light: { canvas: '#ffffff', text: '#18181b' },
  dark: { canvas: '#161618', text: '#ededef' }
};
const chromeColors = () => CHROME[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
const isWindows11 = () => isWin() && Number(os.release().split('.')[2]) >= 22000;

/**
 * macOS: inset traffic lights over a translucent sidebar. Windows: the page
 * draws the title bar under the system caption buttons. Linux keeps its frame.
 */
function platformChrome() {
  const colors = chromeColors();
  if (isMac()) {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000'
    };
  }
  if (isWin()) {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { height: 40, color: colors.canvas, symbolColor: colors.text },
      ...(isWindows11() ? { backgroundMaterial: 'mica' } : {})
    };
  }
  return {};
}

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
      width: 1120,
      height: 720,
      minWidth: 820,
      minHeight: 520,
      show: false,
      title: 'Ghost Notetaker — Notes Manager',
      backgroundColor: chromeColors().canvas,
      autoHideMenuBar: true,
      ...platformChrome(),
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

  /** Recolor what the OS draws (Windows caption buttons, the window background) after a theme change. */
  applyTheme() {
    if (!this.win || this.win.isDestroyed() || isMac()) return;
    const colors = chromeColors();
    this.win.setBackgroundColor(colors.canvas);
    if (isWin()) this.win.setTitleBarOverlay({ color: colors.canvas, symbolColor: colors.text });
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
