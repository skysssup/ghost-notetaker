'use strict';

const { app } = require('electron');

function isMac() {
  return process.platform === 'darwin';
}

function isWin() {
  return process.platform === 'win32';
}

function isLinux() {
  return process.platform === 'linux';
}

function hideDockIcon() {
  if (isMac() && app.dock && typeof app.dock.hide === 'function') {
    try {
      app.dock.hide();
    } catch (_) {
      /* dock may be unavailable in some environments */
    }
  }
}

function acceleratorLabel(accel) {
  if (!accel) return '';
  const isDarwin = isMac();
  return String(accel)
    .replace(/CommandOrControl/g, isDarwin ? '⌘' : 'Ctrl')
    .replace(/Command/g, '⌘')
    .replace(/Control/g, isDarwin ? '⌃' : 'Ctrl')
    .replace(/Alt/g, isDarwin ? '⌥' : 'Alt')
    .replace(/Shift/g, isDarwin ? '⇧' : 'Shift')
    .replace(/\+/g, isDarwin ? '' : '+');
}

function noteWindowOptions(bounds) {
  const opts = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 220,
    minHeight: 180,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: true,
    show: false,
    skipTaskbar: true,
    focusable: true,
    fullscreenable: false,
    webPreferences: {
      preload: null,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };

  if (isMac()) {
    opts.type = 'panel';
    opts.vibrancy = 'under-window';
    opts.visualEffectState = 'active';
  }

  return opts;
}

function applyAlwaysOnTop(win, pinned) {
  if (!win || win.isDestroyed()) return;
  if (pinned) {
    if (isMac()) {
      win.setAlwaysOnTop(true, 'floating');
      try {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      } catch (_) {
        win.setVisibleOnAllWorkspaces(true);
      }
    } else {
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  } else {
    win.setAlwaysOnTop(false);
    if (isMac()) {
      try {
        win.setVisibleOnAllWorkspaces(false);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

function applyContentProtection(win, enabled = true) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setContentProtection(Boolean(enabled));
  } catch (_) {
    /* older Electron / platform */
  }
}

function applyClickThrough(win, enabled, forward = true) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setIgnoreMouseEvents(Boolean(enabled), { forward: Boolean(forward) });
  } catch (_) {
    try {
      win.setIgnoreMouseEvents(Boolean(enabled));
    } catch (__) {
      /* ignore */
    }
  }
}

function applyLaunchAtLogin(enabled) {
  try {
    if (typeof app.setLoginItemSettings === 'function') {
      app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
        openAsHidden: true
      });
      return true;
    }
  } catch (_) {
    /* unsupported */
  }
  return false;
}

function getLaunchAtLogin() {
  try {
    if (typeof app.getLoginItemSettings === 'function') {
      return Boolean(app.getLoginItemSettings().openAtLogin);
    }
  } catch (_) {
    /* unsupported */
  }
  return false;
}

module.exports = {
  isMac,
  isWin,
  isLinux,
  hideDockIcon,
  acceleratorLabel,
  noteWindowOptions,
  applyAlwaysOnTop,
  applyContentProtection,
  applyClickThrough,
  applyLaunchAtLogin,
  getLaunchAtLogin
};
