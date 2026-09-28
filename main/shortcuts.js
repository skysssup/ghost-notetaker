'use strict';

const { globalShortcut, BrowserWindow } = require('electron');
const { defaultShortcuts } = require('./store');

const LOCAL_ACTIONS = [
  { id: 'newNote', label: 'New note', scope: 'local' },
  { id: 'toggleManager', label: 'Open / focus Notes Manager', scope: 'local' },
  { id: 'hideShowAll', label: 'Hide / show all notes', scope: 'local' },
  { id: 'toggleClickThrough', label: 'Toggle click-through (all notes)', scope: 'local' },
  { id: 'togglePreview', label: 'Toggle markdown preview (focused note)', scope: 'local' },
  { id: 'quickCapture', label: 'Quick capture from clipboard', scope: 'local' },
  { id: 'recoveryNewNote', label: 'Recovery: new note (global)', scope: 'global' }
];

class ShortcutController {
  constructor({ getBindings, onAction }) {
    this.getBindings = getBindings;
    this.onAction = onAction;
    this._globalRegistered = null;
  }

  listDefinitions() {
    const bindings = { ...defaultShortcuts(), ...this.getBindings() };
    return LOCAL_ACTIONS.map((a) => ({
      ...a,
      accelerator: bindings[a.id] || ''
    }));
  }

  registerGlobal() {
    this.unregisterGlobal();
    const bindings = { ...defaultShortcuts(), ...this.getBindings() };
    const accel = bindings.recoveryNewNote;
    if (!accel) return;
    try {
      const ok = globalShortcut.register(accel, () => {
        this.onAction('recoveryNewNote');
      });
      this._globalRegistered = ok ? accel : null;
    } catch (_) {
      this._globalRegistered = null;
    }
  }

  unregisterGlobal() {
    try {
      globalShortcut.unregisterAll();
    } catch (_) {
      /* ignore */
    }
    this._globalRegistered = null;
  }

  /**
   * Wire before-input-event on a BrowserWindow so local shortcuts fire
   * only while that window is focused.
   */
  attachLocal(win) {
    if (!win || win.isDestroyed()) return;
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const action = this.matchLocal(input);
      if (!action) return;
      event.preventDefault();
      this.onAction(action);
    });
  }

  matchLocal(input) {
    const bindings = { ...defaultShortcuts(), ...this.getBindings() };
    for (const def of LOCAL_ACTIONS) {
      if (def.scope === 'global') continue;
      const accel = bindings[def.id];
      if (!accel) continue;
      if (matchesAccelerator(input, accel)) return def.id;
    }
    return null;
  }
}

function matchesAccelerator(input, accelerator) {
  const parts = String(accelerator)
    .toLowerCase()
    .split('+')
    .map((p) => p.trim());
  const needCtrl =
    parts.includes('commandorcontrol') ||
    parts.includes('control') ||
    parts.includes('cmd') ||
    parts.includes('command');
  const needAlt = parts.includes('alt') || parts.includes('option');
  const needShift = parts.includes('shift');
  const needMeta =
    parts.includes('command') ||
    parts.includes('cmd') ||
    parts.includes('super') ||
    parts.includes('meta');

  const keyPart = parts.filter(
    (p) =>
      ![
        'commandorcontrol',
        'control',
        'ctrl',
        'command',
        'cmd',
        'alt',
        'option',
        'shift',
        'super',
        'meta'
      ].includes(p)
  )[0];

  if (!keyPart) return false;

  const ctrlPressed = Boolean(input.control || (process.platform === 'darwin' && input.meta));
  const metaPressed = Boolean(input.meta);
  const altPressed = Boolean(input.alt);
  const shiftPressed = Boolean(input.shift);

  if (needCtrl) {
    if (process.platform === 'darwin') {
      if (!input.meta && !input.control) return false;
    } else if (!input.control) {
      return false;
    }
  } else if (needMeta && !metaPressed) {
    return false;
  }

  // When CommandOrControl is used on non-mac, meta shouldn't be required
  if (!needCtrl && !needMeta && (input.control || input.meta)) {
    // allow if accel didn't ask for modifiers — but then reject extra?
  }

  if (needAlt !== altPressed) return false;
  if (needShift !== shiftPressed) return false;

  // If accel has CommandOrControl, we've checked ctrl/meta above.
  // Reject if extra modifiers that weren't requested (soft check on Alt/Shift already done).

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '').toLowerCase();
  if (key === keyPart || code === `key${keyPart}` || code === keyPart) return true;
  if (keyPart.length === 1 && key === keyPart) return true;
  return false;
}

module.exports = {
  ShortcutController,
  LOCAL_ACTIONS,
  matchesAccelerator
};
