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
const { clampBoundsToDisplays, getDisplayById } = require('./display');

const FLUSH_SCRIPT =
  'typeof window.__ghostFlushPending === "function" ? window.__ghostFlushPending() : ({ ok: true })';

/**
 * Note windows are transparent around the paper so its shadow is not cut off:
 * 16px on the top and sides and 32px below, where the shadow is longest. Saved
 * bounds keep the meaning they had when windows left 8px (the paper plus 8px on
 * every side), so a note's paper stays exactly where it was.
 */
const OUTSET = { side: 8, bottom: 24 };
const toWindow = (b) => ({
  x: b.x - OUTSET.side,
  y: b.y - OUTSET.side,
  width: b.width + 2 * OUTSET.side,
  height: b.height + OUTSET.side + OUTSET.bottom
});
const fromWindow = (b) => ({
  x: b.x + OUTSET.side,
  y: b.y + OUTSET.side,
  width: b.width - 2 * OUTSET.side,
  height: b.height - OUTSET.side - OUTSET.bottom
});

/** Window of a note collapsed into a bubble: a 56px circle with the same margins. */
const BUBBLE_SIZE = { width: 88, height: 104 };
const bubbleWindow = (b) => ({ x: b.x - OUTSET.side, y: b.y - OUTSET.side, ...BUBBLE_SIZE });
const NOTE_MIN = { width: 220, height: 180 };

/**
 * Keep a note on a visible work area. macOS and Linux window managers push a window
 * that crosses the edge of the work area back inside, which would move the paper
 * after it appears and save the pushed position, so keep the whole window inside
 * there. Windows places windows where asked.
 */
function clampNote(bounds, displayId) {
  const clamped = clampBoundsToDisplays(bounds, displayId);
  if (isWin()) return clamped;
  const display = getDisplayById(clamped.displayId) || screen.getPrimaryDisplay();
  const area = display.workArea || display.bounds;
  const win = toWindow(clamped);
  const inside = (pos, size, start, length) => Math.max(start, Math.min(pos, start + length - size));
  return {
    ...clamped,
    x: inside(win.x, win.width, area.x, area.width) + OUTSET.side,
    y: inside(win.y, win.height, area.y, area.height) + OUTSET.side
  };
}

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

  /**
   * Bounds to save for a note window. A collapsed note keeps its expanded size;
   * only the bubble's position is recorded.
   */
  _boundsPatch(win, note) {
    const live = win.getBounds();
    const saved = fromWindow(live);
    const bounds = note && note.collapsed ? { ...note.bounds, x: saved.x, y: saved.y } : saved;
    const display = screen.getDisplayMatching(live);
    return { bounds, displayId: display ? display.id : null };
  }

  /** Open (or focus) a note window. `edit` starts it in the editor with the caret ready. */
  async open(noteId, { edit = false } = {}) {
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

    const clamped = clampNote(note.bounds, note.displayId);
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

    const opts = noteWindowOptions(note.collapsed ? bubbleWindow(clamped) : toWindow(clamped));
    if (note.collapsed) {
      opts.minWidth = BUBBLE_SIZE.width;
      opts.minHeight = BUBBLE_SIZE.height;
      opts.resizable = false;
    }
    opts.webPreferences.preload = path.join(__dirname, '..', 'renderer', 'note', 'preload.js');

    const win = new BrowserWindow(opts);
    this.windows.set(noteId, win);

    applyContentProtection(win, this._contentProtectionEnabled());
    applyAlwaysOnTop(win, note.pinned);

    win.loadFile(path.join(__dirname, '..', 'renderer', 'note', 'note.html'), {
      query: edit ? { id: noteId, edit: '1' } : { id: noteId }
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
        if (!win.isDestroyed()) this.store.updateNote(noteId, this._boundsPatch(win, this.store.getNote(noteId)));
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
    this.store.updateNote(noteId, { visible: false, ...this._boundsPatch(win, this.store.getNote(noteId)) });
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
      if (persistBounds && !win.isDestroyed()) {
        this.store.updateNote(id, this._boundsPatch(win, this.store.getNote(id)));
      }
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
    // A bubble must stay clickable so the note can be expanded again.
    applyClickThrough(win, !note.collapsed && (global || note.clickThrough), true);
  }

  /** Shrink a note to a draggable bubble or expand it back at the same place. */
  setCollapsed(noteId, collapsed) {
    const win = this.windows.get(noteId);
    const note = this.store.getNote(noteId);
    if (!note || !win || win.isDestroyed() || note.collapsed === collapsed) return note;
    const live = win.getBounds();
    if (collapsed) {
      this.store.updateNote(noteId, { collapsed: true, ...this._boundsPatch(win, note) });
      win.setResizable(false);
      win.setMinimumSize(BUBBLE_SIZE.width, BUBBLE_SIZE.height);
      win.setBounds({ x: live.x, y: live.y, ...BUBBLE_SIZE });
    } else {
      const saved = fromWindow(live);
      const expanded = clampNote({ ...note.bounds, x: saved.x, y: saved.y }, note.displayId);
      const bounds = { x: expanded.x, y: expanded.y, width: expanded.width, height: expanded.height };
      win.setMinimumSize(NOTE_MIN.width, NOTE_MIN.height);
      win.setResizable(true);
      win.setBounds(toWindow(bounds));
      this.store.updateNote(noteId, { collapsed: false, bounds, displayId: expanded.displayId });
    }
    this.applyNoteAppearance(noteId);
    this.onChanged();
    return this.store.getNote(noteId);
  }

  /** Move a note window by a pointer delta (dragging a bubble). */
  moveBy(noteId, dx, dy) {
    const win = this.windows.get(noteId);
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
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

  /** Send the same message to every open note window. */
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
      const saved = fromWindow(win.getBounds());
      const source = note.collapsed ? { ...note.bounds, x: saved.x, y: saved.y } : saved;
      const clamped = clampNote(source, note.displayId);
      const bounds = { x: clamped.x, y: clamped.y, width: clamped.width, height: clamped.height };
      win.setBounds(note.collapsed ? bubbleWindow(bounds) : toWindow(bounds));
      this.store.updateNote(id, { bounds, displayId: clamped.displayId });
    }
  }
}

module.exports = { NoteWindowController, BUBBLE_SIZE };
