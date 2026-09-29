'use strict';

const { globalShortcut } = require('electron');
const { defaultShortcuts } = require('./store');
const { matchesAccelerator, SHORTCUT_ACTIONS } = require('./accelerator');

const LOCAL_ACTIONS = SHORTCUT_ACTIONS;

class ShortcutController {
  constructor({ getBindings, onAction }) {
    this.getBindings = getBindings;
    this.onAction = onAction;
    this._globalRegistered = [];
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
    const registered = [];
    const seen = new Set();

    for (const def of LOCAL_ACTIONS) {
      if (def.scope !== 'global') continue;
      const accel = bindings[def.id];
      if (!accel || seen.has(accel)) continue;
      seen.add(accel);
      try {
        const ok = globalShortcut.register(accel, () => {
          this.onAction(def.id);
        });
        if (ok) registered.push(accel);
      } catch (_) {
        /* accelerator may conflict with OS / another app */
      }
    }
    this._globalRegistered = registered;
  }

  unregisterGlobal() {
    try {
      globalShortcut.unregisterAll();
    } catch (_) {
      /* ignore */
    }
    this._globalRegistered = [];
  }

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
      const accel = bindings[def.id];
      if (!accel) continue;
      if (matchesAccelerator(input, accel)) return def.id;
    }
    return null;
  }
}

module.exports = {
  ShortcutController,
  LOCAL_ACTIONS,
  matchesAccelerator
};
