'use strict';

const { globalShortcut } = require('electron');
const { defaultShortcuts } = require('./store');
const {
  matchesAccelerator,
  normalizeAccelerator,
  formatAccelerator,
  SHORTCUT_ACTIONS
} = require('./accelerator');

class ShortcutController {
  constructor({ getBindings, onAction }) {
    this.getBindings = getBindings;
    this.onAction = onAction;
    /** @type {Record<string, 'active' | 'unavailable' | 'duplicate' | 'invalid' | 'off' | 'local'>} */
    this._status = {};
    this._paused = false;
  }

  /** Release every shortcut while the user records a new one, then restore them. */
  pause(paused) {
    if (paused === this._paused) return;
    this._paused = paused;
    if (paused) this.unregisterGlobal();
    else this.registerGlobal();
  }

  _bindings() {
    return { ...defaultShortcuts(), ...this.getBindings() };
  }

  /** Every action with its binding, display label, and registration status. */
  listDefinitions() {
    const bindings = this._bindings();
    return SHORTCUT_ACTIONS.map((a) => {
      const accelerator = normalizeAccelerator(bindings[a.id]) || '';
      return {
        ...a,
        accelerator,
        display: formatAccelerator(accelerator),
        defaultAccelerator: defaultShortcuts()[a.id],
        status: this._status[a.id] || (a.scope === 'local' ? 'local' : 'off')
      };
    });
  }

  registerGlobal() {
    this.unregisterGlobal();
    this._paused = false;
    const bindings = this._bindings();
    const owner = new Map();
    const status = {};

    for (const def of SHORTCUT_ACTIONS) {
      const accel = normalizeAccelerator(bindings[def.id]);
      if (accel === null) {
        status[def.id] = 'invalid';
        continue;
      }
      if (!accel) {
        status[def.id] = 'off';
        continue;
      }
      if (owner.has(accel)) {
        status[def.id] = 'duplicate';
        continue;
      }
      owner.set(accel, def.id);
      if (def.scope !== 'global') {
        status[def.id] = 'local';
        continue;
      }
      let ok = false;
      try {
        ok = globalShortcut.register(accel, () => this.onAction(def.id));
      } catch (_) {
        ok = false;
      }
      status[def.id] = ok ? 'active' : 'unavailable';
    }
    this._status = status;
    return this.listDefinitions();
  }

  unregisterGlobal() {
    try {
      globalShortcut.unregisterAll();
    } catch (_) {
      /* ignore */
    }
    this._status = {};
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

  /**
   * In-window fallback: local actions always, global actions only when their
   * global registration failed (otherwise the OS-level hotkey already fired).
   */
  matchLocal(input) {
    if (this._paused) return null;
    const bindings = this._bindings();
    for (const def of SHORTCUT_ACTIONS) {
      if (def.scope === 'global' && this._status[def.id] === 'active') continue;
      if (matchesAccelerator(input, bindings[def.id])) return def.id;
    }
    return null;
  }
}

module.exports = { ShortcutController };
