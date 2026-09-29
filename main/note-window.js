'use strict';

const path = require('path');
const { BrowserWindow } = require('electron');
const {
  noteWindowOptions,
  applyAlwaysOnTop,
  applyContentProtection,
  applyClickThrough,
  isWin
} = require('./platform');
const { clampBoundsToDisplays } = require('./display');

class NoteWindowController {
  constructor({ store, onChanged, attachShortcuts }) {
    this.store = store;
    this.onChanged = onChanged || (() => {});
    this.attachShortcuts = attachShortcuts || (() => {});
    /** @type {Map<string, BrowserWindow>} */
    this.windows = new Map();
    this._lastHiddenBatch = [];
  }

  get(id) {
    return this.windows.get(id) || null;
  }

  listOpenIds() {
    return Array.from(this.windows.keys());
  }

  _contentProtectionEnabled() {
    const s = this.store.getSettings();
    return s.contentProtection !== false;
  }

  async open(noteId) {
    const existing = this.windows.get(noteId);
    if (existing && !existing.isDestroyed()) {
      applyContentProtection(existing, this._contentProtectionEnabled());
      if (!existing.isVisible()) existing.show();
      existing.focus();
      this.store.touchRecent(noteId);
      return existing;
    }

    const note = this.store.getNote(noteId);
    if (!note) return null;

    const clamped = clampBoundsToDisplays(note.bounds, note.displayId);
    if (
      clamped.x !== note.bounds.x ||
      clamped.y !== note.bounds.y ||
      clamped.displayId !== note.displayId
    ) {
      this.store.updateNote(noteId, {
        bounds: { x: clamped.x, y: clamped.y, width: clamped.width, height: clamped.height },
        displayId: clamped.displayId
      });
    }

    const opts = noteWindowOptions({
      x: clamped.x,
      y: clamped.y,
      width: clamped.width,
      height: clamped.height
    });
    opts.webPreferences.preload = path.join(__dirname, '..', 'renderer', 'note', 'preload.js');

    const win = new BrowserWindow(opts);
    this.windows.set(noteId, win);

    applyContentProtection(win, this._contentProtectionEnabled());
    applyAlwaysOnTop(win, note.pinned);
    win.setOpacity(1);

    win.loadFile(path.join(__dirname, '..', 'renderer', 'note', 'note.html'), {
      query: { id: noteId }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      // Stay on the local note page; never follow in-window navigations.
      if (!url.startsWith('file:')) event.preventDefault();
    });

    this.attachShortcuts(win);

    win.once('ready-to-show', () => {
      applyContentProtection(win, this._contentProtectionEnabled());
      const fresh = this.store.getNote(noteId);
      if (fresh) {
        applyAlwaysOnTop(win, fresh.pinned);
        this._syncClickThrough(win, fresh);
      }
      win.show();
      this.store.updateNote(noteId, { visible: true });
      this.store.touchRecent(noteId);
      this.onChanged();
    });

    win.on('show', () => {
      if (isWin()) applyContentProtection(win, this._contentProtectionEnabled());
    });

    win.on('hide', () => {
      /* content protection re-applied on next show (Windows) */
    });

    const persistBounds = () => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      const display = require('electron').screen.getDisplayMatching(b);
      this.store.updateNote(noteId, {
        bounds: b,
        displayId: display ? display.id : null
      });
    };

    win.on('moved', persistBounds);
    win.on('resized', persistBounds);

    win.on('close', (e) => {
      // Close hides — never destroy from the window chrome
      e.preventDefault();
      this.hide(noteId);
    });

    win.on('closed', () => {
      this.windows.delete(noteId);
      this.onChanged();
    });

    return win;
  }

  hide(noteId) {
    const win = this.windows.get(noteId);
    this.store.updateNote(noteId, { visible: false });
    if (win && !win.isDestroyed()) {
      win.hide();
      // Destroy to free resources; reopen recreates
      win.destroy();
    }
    this.windows.delete(noteId);
    this.onChanged();
  }

  closeAndDestroy(noteId) {
    const win = this.windows.get(noteId);
    if (win && !win.isDestroyed()) {
      win.removeAllListeners('close');
      win.destroy();
    }
    this.windows.delete(noteId);
  }

  destroyAll() {
    for (const id of Array.from(this.windows.keys())) {
      this.closeAndDestroy(id);
    }
  }

  async openVisibleNotes() {
    const notes = this.store.listNotes().filter((n) => n.visible);
    for (const n of notes) {
      await this.open(n.id);
    }
  }

  hideAll() {
    const ids = Array.from(this.windows.keys());
    for (const id of ids) this.hide(id);
  }

  async toggleHideShowAll() {
    const open = this.listOpenIds();
    if (open.length > 0) {
      this._lastHiddenBatch = open.slice();
      this.hideAll();
      return 'hidden';
    }
    const batch = Array.isArray(this._lastHiddenBatch) ? this._lastHiddenBatch : [];
    this._lastHiddenBatch = [];
    if (batch.length) {
      for (const id of batch) {
        if (this.store.getNote(id)) {
          this.store.updateNote(id, { visible: true });
          await this.open(id);
        }
      }
      return 'shown';
    }
    const notes = this.store.listNotes({
      workspaceId: this.store.getActiveWorkspaceId()
    });
    const toOpen = notes.filter((n) => n.visible);
    if (toOpen.length === 0 && notes.length) {
      const latest = notes[0];
      this.store.updateNote(latest.id, { visible: true });
      await this.open(latest.id);
    } else {
      for (const n of toOpen) await this.open(n.id);
    }
    return 'shown';
  }

  applyNoteAppearance(noteId) {
    const note = this.store.getNote(noteId);
    const win = this.windows.get(noteId);
    if (!note || !win || win.isDestroyed()) return;
    applyAlwaysOnTop(win, note.pinned);
    this._syncClickThrough(win, note);
    win.webContents.send('note:updated', note);
  }

  _syncClickThrough(win, note) {
    const global = this.store.getSettings().globalClickThrough;
    const enabled = global || note.clickThrough;
    applyClickThrough(win, enabled, true);
  }

  setGlobalClickThrough(enabled) {
    this.store.updateSettings({ globalClickThrough: Boolean(enabled) });
    for (const [id, win] of this.windows) {
      if (win.isDestroyed()) continue;
      const note = this.store.getNote(id);
      if (note) this._syncClickThrough(win, note);
    }
  }

  toggleGlobalClickThrough() {
    const next = !this.store.getSettings().globalClickThrough;
    this.setGlobalClickThrough(next);
    return next;
  }

  broadcast(channel, payload) {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  reapplyContentProtection() {
    const enabled = this._contentProtectionEnabled();
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) applyContentProtection(win, enabled);
    }
  }

  clampAllToDisplays() {
    for (const [id, win] of this.windows) {
      if (win.isDestroyed()) continue;
      const note = this.store.getNote(id);
      if (!note) continue;
      const clamped = clampBoundsToDisplays(win.getBounds(), note.displayId);
      win.setBounds({
        x: clamped.x,
        y: clamped.y,
        width: clamped.width,
        height: clamped.height
      });
      this.store.updateNote(id, {
        bounds: {
          x: clamped.x,
          y: clamped.y,
          width: clamped.width,
          height: clamped.height
        },
        displayId: clamped.displayId
      });
    }
  }
}

module.exports = { NoteWindowController };
