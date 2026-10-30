'use strict';

const { app, systemPreferences } = require('electron');

function isMac() {
  return process.platform === 'darwin';
}

function isWin() {
  return process.platform === 'win32';
}

/**
 * What the current OS actually supports. Electron implements content
 * protection, login items, and mouse-move forwarding for click-through windows
 * only on macOS and Windows; on Linux these calls are silent no-ops.
 */
function capabilities() {
  const native = isMac() || isWin();
  return {
    contentProtection: native,
    launchAtLogin: native,
    clickThroughHover: native
  };
}

/** The OS accent color as #rrggbb on macOS and Windows; null elsewhere. */
function accentColor() {
  if (!isMac() && !isWin()) return null;
  try {
    const rgba = systemPreferences.getAccentColor();
    return /^[0-9a-f]{6,8}$/i.test(rgba) ? `#${rgba.slice(0, 6)}` : null;
  } catch (_) {
    return null;
  }
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

/**
 * Every note window has this title, whatever the note is called: window titles
 * show in the taskbar, window switchers, and screen-share pickers.
 */
const NOTE_WINDOW_TITLE = 'Ghost Note';

function noteWindowOptions(bounds) {
  const opts = {
    title: NOTE_WINDOW_TITLE,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 220,
    minHeight: 180,
    frame: false,
    transparent: true,
    resizable: true,
    // The window is the paper (transparent only so its corners can be rounded). macOS adds
    // its native window shadow, the one shadow a note has; elsewhere the paper is flat.
    hasShadow: isMac(),
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

  if (isMac()) opts.type = 'panel';

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

/** Best-effort: Electron setContentProtection is not honored by every capturer. */
function applyContentProtection(win, enabled = true) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setContentProtection(Boolean(enabled));
  } catch (_) {
    /* older Electron / platform without the API */
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
  if (!capabilities().launchAtLogin) return false;
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: true
    });
    return true;
  } catch (_) {
    return false;
  }
}

function getLaunchAtLogin() {
  if (!capabilities().launchAtLogin) return false;
  try {
    return Boolean(app.getLoginItemSettings().openAtLogin);
  } catch (_) {
    return false;
  }
}

module.exports = {
  NOTE_WINDOW_TITLE,
  isMac,
  isWin,
  capabilities,
  accentColor,
  hideDockIcon,
  noteWindowOptions,
  applyAlwaysOnTop,
  applyContentProtection,
  applyClickThrough,
  applyLaunchAtLogin,
  getLaunchAtLogin
};
