'use strict';

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const {
  noteWindowOptions,
  applyAlwaysOnTop,
  applyContentProtection,
  applyClickThrough,
  isWin
} = require('./platform');
const { clampBoundsToDisplays } = require('./display');

const FLUSH_SCRIPT =
  'typeof window.__ghostFlushPending === "function" ? window.__ghostFlushPending() : ({ ok: true })';

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
    return this.store.getSettings().contentProtection !== false;
  }

  _boundsPatch(win) {
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    return { bounds, displayId: display ? display.id : null };
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

    win.loadFile(path.join(__dirname, '..', 'renderer', 'note', 'note.html'), {
      query: { id: noteId }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // The note page is loaded once; links and dropped files must never replace it.
    win.webContents.on('will-navigate', (event) => event.preventDefault());

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

    // 'moved'/'resized' only exist on macOS and Windows; 'move'/'resize' fire
    // everywhere (continuously while dragging), so persist once they settle.
    let boundsTimer = null;
    const persistBounds = () => {
      clearTimeout(boundsTimer);
      boundsTimer = setTimeout(() => {
        if (!win.isDestroyed()) this.store.updateNote(noteId, this._boundsPatch(win));
      }, 300);
    };
    win.on('move', persistBounds);
    win.on('resize', persistBounds);

    win.on('close', (e) => {
      // Closing from the OS (Alt+F4, window menu) hides the note; it is never deleted here.
      e.preventDefault();
      this.hide(noteId);
    });

    win.on('closed', () => {
      clearTimeout(boundsTimer);
      if (this.windows.get(noteId) === win) this.windows.delete(noteId);
      this.onChanged();
    });

    return win;
  }

  /** Ask a note renderer to save its debounced edits. Resolves to { ok, message? }. */
  async flushWindow(win, timeoutMs = 2000) {
    if (!win || win.isDestroyed() || win.webContents.isCrashed()) return { ok: true };
    let timer = null;
    try {
      const result = await Promise.race([
        win.webContents.executeJavaScript(FLUSH_SCRIPT, true),
        new Promise((resolve) => {
          timer = setTimeout(
            () => resolve({ ok: false, message: 'Timed out waiting for the note to save' }),
            timeoutMs
          );
        })
      ]);
      return result && typeof result === 'object' ? result : { ok: true };
    } catch (err) {
      if (win.isDestroyed()) return { ok: true };
      return { ok: false, message: err && err.message ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Hide a note window after its pending edits are saved. If saving fails the
   * window stays open (the note shows the error) so nothing typed is lost.
   */
  async hide(noteId) {
    const win = this.windows.get(noteId);
    if (!win || win.isDestroyed()) {
      this.windows.delete(noteId);
      this.store.updateNote(noteId, { visible: false });
      this.onChanged();
      return { id: noteId, ok: true };
    }
    const flushed = await this.flushWindow(win);
    if (!flushed.ok) return { id: noteId, ok: false, message: flushed.message };
    if (win.isDestroyed()) return { id: noteId, ok: true };
    this.store.updateNote(noteId, { visible: false, ...this._boundsPatch(win) });
    this.windows.delete(noteId);
    win.destroy();
    this.onChanged();
    return { id: noteId, ok: true };
  }

  async hideAll() {
    const results = [];
    for (const id of this.listOpenIds()) results.push(await this.hide(id));
    return results;
  }

  /** Destroy a window without saving it (the note is being deleted or replaced). */
  closeAndDestroy(noteId) {
    const win = this.windows.get(noteId);
    this.windows.delete(noteId);
    if (win && !win.isDestroyed()) win.destroy();
  }

  /** Destroy every window; with persistBounds, record final positions first (quit). */
  destroyAll({ persistBounds = false } = {}) {
    for (const [id, win] of Array.from(this.windows.entries())) {
      if (persistBounds && !win.isDestroyed()) this.store.updateNote(id, this._boundsPatch(win));
      this.closeAndDestroy(id);
    }
  }

  /** Flush every open note renderer. Returns per-window { id, ok, message? }. */
  async flushAllPending(timeoutMs = 2000) {
    const results = [];
    for (const [id, win] of Array.from(this.windows.entries())) {
      results.push({ id, ...(await this.flushWindow(win, timeoutMs)) });
    }
    return results;
  }

  async openVisibleNotes() {
    const notes = this.store.listNotes().filter((n) => n.visible);
    for (const n of notes) {
      await this.open(n.id);
    }
  }

  async toggleHideShowAll() {
    const open = this.listOpenIds();
    if (open.length > 0) {
      this._lastHiddenBatch = open.slice();
      const results = await this.hideAll();
      return { action: 'hidden', failed: results.filter((r) => !r.ok) };
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
      return { action: 'shown', failed: [] };
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
    return { action: 'shown', failed: [] };
  }

  /**
   * Re-apply window state for a note. `notifyRenderer: false` skips echoing the
   * note back to its own window when the change came from that window.
   */
  applyNoteAppearance(noteId, { notifyRenderer = true } = {}) {
    const note = this.store.getNote(noteId);
    const win = this.windows.get(noteId);
    if (!note || !win || win.isDestroyed()) return;
    applyAlwaysOnTop(win, note.pinned);
    this._syncClickThrough(win, note);
    if (notifyRenderer) win.webContents.send('note:updated', note);
  }

  _syncClickThrough(win, note) {
    const global = this.store.getSettings().globalClickThrough;
    applyClickThrough(win, global || note.clickThrough, true);
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
      const bounds = { x: clamped.x, y: clamped.y, width: clamped.width, height: clamped.height };
      win.setBounds(bounds);
      this.store.updateNote(id, { bounds, displayId: clamped.displayId });
    }
  }
}

module.exports = { NoteWindowController };
