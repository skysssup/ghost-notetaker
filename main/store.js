'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_VERSION = 2;

// Paper colors. `ink` is the text color that reads on the paper. The ids are
// stored in notes files and never change.
const NOTE_COLORS = [
  { id: 'amber', hex: '#fce7a6', label: 'Butter', ink: 'dark' },
  { id: 'peach', hex: '#ffdab6', label: 'Peach', ink: 'dark' },
  { id: 'coral', hex: '#ffcdc3', label: 'Blush', ink: 'dark' },
  { id: 'rose', hex: '#ffd2e7', label: 'Rose', ink: 'dark' },
  { id: 'lavender', hex: '#e6dafe', label: 'Lavender', ink: 'dark' },
  { id: 'sky', hex: '#c7eaff', label: 'Sky', ink: 'dark' },
  { id: 'mint', hex: '#c0f7d8', label: 'Mint', ink: 'dark' },
  { id: 'mist', hex: '#e0eaee', label: 'Mist', ink: 'dark' },
  { id: 'ivory', hex: '#f8f5ec', label: 'Paper', ink: 'dark' },
  { id: 'teal', hex: '#174543', label: 'Deep teal', ink: 'light' },
  { id: 'indigo', hex: '#323153', label: 'Night', ink: 'light' },
  { id: 'slate', hex: '#2a2e34', label: 'Graphite', ink: 'light' }
];

const TEMPLATES = {
  blank: {
    id: 'blank',
    label: 'Blank note',
    title: 'Untitled',
    content: ''
  },
  meeting: {
    id: 'meeting',
    label: 'Meeting notes',
    title: 'Meeting notes',
    content: [
      '# Meeting',
      '',
      '**Date:** ',
      '**Attendees:** ',
      '',
      '## Agenda',
      '- [ ] Item 1',
      '- [ ] Item 2',
      '',
      '## Notes',
      '',
      '',
      '## Action items',
      '- [ ] '
    ].join('\n')
  },
  bug: {
    id: 'bug',
    label: 'Bug triage',
    title: 'Bug',
    content: [
      '# Bug',
      '',
      '**Repro:**',
      '1. ',
      '',
      '**Expected:**',
      '',
      '**Actual:**',
      '',
      '## Notes',
      '- '
    ].join('\n')
  },
  todo: {
    id: 'todo',
    label: 'Todo list',
    title: 'Todo list',
    content: [
      '# Todos',
      '',
      '- [ ] High priority',
      '- [ ] Medium priority',
      '- [ ] Low priority',
      '',
      '## Done',
      '- [x] Example completed item'
    ].join('\n')
  },
  scratch: {
    id: 'scratch',
    label: 'Scratch pad',
    title: 'Scratch',
    content: [
      '# Scratch',
      '',
      '- Idea:',
      '- Link:',
      '- Follow-up:'
    ].join('\n')
  },
  daily: {
    id: 'daily',
    label: 'Daily standup',
    title: 'Daily standup',
    content: [
      '# Standup',
      '',
      '**Date:** ',
      '',
      '## Yesterday',
      '- ',
      '',
      '## Today',
      '- [ ] ',
      '',
      '## Blockers',
      '- '
    ].join('\n')
  },
  talking: {
    id: 'talking',
    label: 'Talking points',
    title: 'Talking points',
    content: [
      '# Talking points',
      '',
      '1. Start with the problem',
      '2. Show the demo',
      '3. Ask for the next step',
      '',
      '## Questions to expect',
      '- '
    ].join('\n')
  },
  decision: {
    id: 'decision',
    label: 'Decision log',
    title: 'Decision',
    content: [
      '# Decision',
      '',
      '**Context:** ',
      '**Options considered:** ',
      '',
      '## Decision',
      '',
      '',
      '## Why',
      '- ',
      '',
      '## Follow-ups',
      '- [ ] '
    ].join('\n')
  }
};

const THEMES = ['system', 'light', 'dark'];
const MANAGER_VIEWS = ['board', 'list'];

/** Per-shortcut override: 'app' keeps a binding inside the app instead of system-wide. */
function normalizeScopes(scopes) {
  const out = {};
  if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes)) return out;
  for (const id of Object.keys(defaultShortcuts())) {
    if (scopes[id] === 'app' || scopes[id] === 'global') out[id] = scopes[id];
  }
  return out;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

const TITLE_MAX = 200;
const CONTENT_MAX = 200000;
const TAG_MAX_LEN = 32;
const TAG_MAX_COUNT = 48;

/** Lowercase, trim, drop empties, dedupe — keeps first-seen casing form as lowercase. */
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const t = String(raw || '')
      .trim()
      .replace(/^#+/, '')
      .toLowerCase()
      .slice(0, TAG_MAX_LEN);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= TAG_MAX_COUNT) break;
  }
  return out;
}

function clampTitle(title) {
  return String(title != null ? title : 'Untitled').slice(0, TITLE_MAX);
}

function clampContent(content) {
  return String(content != null ? content : '').slice(0, CONTENT_MAX);
}

function nowIso() {
  return new Date().toISOString();
}

function defaultWorkspace() {
  const id = createId('ws');
  return {
    id,
    name: 'Personal',
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function defaultShortcuts() {
  return {
    newNote: 'CommandOrControl+Shift+N',
    recoveryNewNote: 'CommandOrControl+Alt+Shift+N',
    toggleManager: 'CommandOrControl+Shift+M',
    hideShowAll: 'CommandOrControl+Shift+H',
    toggleClickThrough: 'CommandOrControl+Shift+G',
    togglePreview: 'CommandOrControl+Shift+P',
    quickCapture: 'CommandOrControl+Shift+Q'
  };
}

function defaultSettings() {
  return {
    globalClickThrough: false,
    contentProtection: true,
    launchAtLogin: false,
    defaultOpacity: 1,
    defaultFontSize: 14,
    defaultColor: 'amber',
    defaultMonospace: false,
    sortBy: 'updated',
    recentNoteIds: [],
    shortcuts: defaultShortcuts(),
    shortcutScopes: {},
    theme: 'system',
    managerView: 'list',
    formattedWhenIdle: true
  };
}

function emptyState() {
  const ws = defaultWorkspace();
  return {
    version: STORE_VERSION,
    activeWorkspaceId: ws.id,
    workspaces: [ws],
    notes: [],
    settings: defaultSettings()
  };
}

function defaultNoteBounds() {
  return { x: 120, y: 120, width: 360, height: 300 };
}

function isKnownColor(id) {
  return NOTE_COLORS.some((c) => c.id === id);
}

function isIsoDate(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function createNoteRecord(partial = {}, settings = null) {
  const stamp = nowIso();
  const defaults = settings || defaultSettings();
  return {
    id: partial.id || createId('note'),
    workspaceId: partial.workspaceId,
    title: clampTitle(partial.title != null ? partial.title : 'Untitled'),
    content: clampContent(partial.content != null ? partial.content : ''),
    tags: normalizeTags(partial.tags),
    color: isKnownColor(partial.color)
      ? partial.color
      : isKnownColor(defaults.defaultColor)
        ? defaults.defaultColor
        : 'mist',
    opacity: clamp(
      partial.opacity != null ? Number(partial.opacity) : defaults.defaultOpacity,
      0.25,
      1
    ),
    fontSize: clamp(
      partial.fontSize != null ? Number(partial.fontSize) : defaults.defaultFontSize,
      10,
      28
    ),
    monospace: partial.monospace != null ? Boolean(partial.monospace) : Boolean(defaults.defaultMonospace),
    pinned: partial.pinned !== false,
    clickThrough: Boolean(partial.clickThrough),
    previewMode: Boolean(partial.previewMode),
    collapsed: Boolean(partial.collapsed),
    visible: partial.visible !== false,
    trashedAt: isIsoDate(partial.trashedAt) ? partial.trashedAt : null,
    bounds: normalizeBounds(partial.bounds || defaultNoteBounds()),
    displayId: partial.displayId != null ? partial.displayId : null,
    createdAt: partial.createdAt || stamp,
    updatedAt: partial.updatedAt || stamp
  };
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeBounds(b = {}) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) b = {};
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  return {
    x: Math.round(clamp(finite(b.x, 0), -1000000, 1000000)),
    y: Math.round(clamp(finite(b.y, 0), -1000000, 1000000)),
    width: Math.round(clamp(finite(b.width, 360), 200, 16384)),
    height: Math.round(clamp(finite(b.height, 300), 160, 16384))
  };
}

function validateBackupRecords(raw) {
  if (raw.version != null && (!Number.isInteger(raw.version) || raw.version < 1 || raw.version > STORE_VERSION)) {
    throw new Error('Unsupported backup version');
  }
  for (const key of ['notes', 'workspaces']) {
    if (raw[key] != null && !Array.isArray(raw[key])) throw new Error(`${key} must be an array`);
    const ids = new Set();
    for (const item of raw[key] || []) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid ${key} record`);
      if (item.id != null && (typeof item.id !== 'string' || !item.id || ids.has(item.id))) throw new Error(`Invalid or duplicate ${key} id`);
      if (item.id) ids.add(item.id);
      for (const field of key === 'notes' ? ['title', 'content', 'workspaceId'] : ['name']) {
        if (item[field] != null && typeof item[field] !== 'string') throw new Error(`Invalid ${key}.${field}`);
      }
    }
  }
}

function migrate(raw) {
  if (!raw || typeof raw !== 'object') return emptyState();
  const state = emptyState();
  if (Array.isArray(raw.workspaces) && raw.workspaces.length) {
    state.workspaces = raw.workspaces.map((w) => ({
      id: w.id || createId('ws'),
      name: String(w.name || 'Workspace'),
      createdAt: w.createdAt || nowIso(),
      updatedAt: w.updatedAt || nowIso()
    }));
  }
  state.activeWorkspaceId =
    raw.activeWorkspaceId && state.workspaces.some((w) => w.id === raw.activeWorkspaceId)
      ? raw.activeWorkspaceId
      : state.workspaces[0].id;

  const settings = {
    ...defaultSettings(),
    ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {})
  };
  settings.shortcuts = {
    ...defaultShortcuts(),
    ...(raw.settings && raw.settings.shortcuts ? raw.settings.shortcuts : {})
  };
  settings.recentNoteIds = Array.isArray(settings.recentNoteIds)
    ? settings.recentNoteIds.map(String).slice(0, 12)
    : [];
  settings.defaultOpacity = clamp(Number(settings.defaultOpacity), 0.25, 1);
  settings.defaultFontSize = clamp(Number(settings.defaultFontSize), 10, 28);
  settings.contentProtection = settings.contentProtection !== false;
  settings.launchAtLogin = Boolean(settings.launchAtLogin);
  settings.globalClickThrough = Boolean(settings.globalClickThrough);
  settings.defaultMonospace = Boolean(settings.defaultMonospace);
  settings.sortBy = ['updated', 'created', 'title', 'color'].includes(settings.sortBy)
    ? settings.sortBy
    : 'updated';
  settings.theme = THEMES.includes(settings.theme) ? settings.theme : 'system';
  settings.managerView = MANAGER_VIEWS.includes(settings.managerView) ? settings.managerView : 'list';
  settings.formattedWhenIdle = settings.formattedWhenIdle !== false;
  settings.shortcutScopes = normalizeScopes(settings.shortcutScopes);
  if (!NOTE_COLORS.some((c) => c.id === settings.defaultColor)) {
    settings.defaultColor = 'mist';
  }
  state.settings = settings;

  if (Array.isArray(raw.notes)) {
    state.notes = raw.notes.map((n) =>
      createNoteRecord(
        {
          ...n,
          workspaceId:
            n.workspaceId && state.workspaces.some((w) => w.id === n.workspaceId)
              ? n.workspaceId
              : state.activeWorkspaceId
        },
        settings
      )
    );
  }

  state.version = STORE_VERSION;
  return state;
}

function sortNotes(notes, sortBy) {
  const list = notes.slice();
  switch (sortBy) {
    case 'created':
      list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      break;
    case 'title':
      list.sort((a, b) =>
        String(a.title || '').localeCompare(String(b.title || ''), undefined, {
          sensitivity: 'base'
        })
      );
      break;
    case 'color':
      list.sort((a, b) => String(a.color).localeCompare(String(b.color)));
      break;
    case 'updated':
    default:
      list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      break;
  }
  return list;
}

const SAVE_RETRY_MS = 2000;
const TRASH_DAYS = 30;
const BACKUP_KEEP = 10;
const BACKUP_NAME = /^ghost-notetaker-\d{4}-\d{2}-\d{2}(-\d{6})?\.json$/;
const IMAGE_NAME = /^[a-f0-9]{16}\.(png|jpg|gif|webp)$/;
const IMAGE_REF = /ghost-image:\/\/img\/([a-f0-9]{16}\.(?:png|jpg|gif|webp))/g;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_GRACE_MS = 60 * 60 * 1000;
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/** Detect an image type from its first bytes; the file name never decides. */
function imageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  return null;
}

function localStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return {
    day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  };
}

class Store {
  /**
   * @param {string} filePath
   * @param {{ onSaveStateChange?: (state: { ok: boolean, message?: string }) => void }} [options]
   *   Called when writing to disk starts failing or recovers.
   */
  constructor(filePath, { onSaveStateChange } = {}) {
    this.filePath = filePath;
    this.state = emptyState();
    this._saveTimer = null;
    this._blockSave = false;
    this._dirty = false;
    this._lastSaveError = null;
    this.loadError = null;
    this.onSaveStateChange = onSaveStateChange || (() => {});
  }

  _setSaveError(err) {
    const changed = Boolean(err) !== Boolean(this._lastSaveError);
    this._lastSaveError = err;
    if (changed) {
      this.onSaveStateChange(err ? { ok: false, message: err.message || String(err) } : { ok: true });
    }
  }

  /**
   * Read the store from disk. Unparseable or structurally invalid data is
   * quarantined; I/O errors (missing permissions, full disk) are thrown so the
   * caller can report them instead of mislabeling a readable file as corrupt.
   */
  load() {
    this.loadError = null;
    this._blockSave = false;
    this._dirty = false;
    this._lastSaveError = null;
    if (!fs.existsSync(this.filePath)) {
      this.state = emptyState();
      this.saveSync();
      return this.state;
    }
    const text = fs.readFileSync(this.filePath, 'utf8');
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (parseErr) {
      return this._quarantineCorrupt(parseErr);
    }
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Store root must be a JSON object');
      }
      if (raw.notes != null && !Array.isArray(raw.notes)) {
        throw new Error('Store notes must be an array when present');
      }
      if (raw.workspaces != null && !Array.isArray(raw.workspaces)) {
        throw new Error('Store workspaces must be an array when present');
      }
      validateBackupRecords(raw);
      this.state = migrate(raw);
    } catch (err) {
      return this._quarantineCorrupt(err);
    }
    return this.state;
  }

  _quarantineCorrupt(err) {
    const stamp = Date.now();
    const quarantinePath = `${this.filePath}.corrupt.${stamp}`;
    try {
      fs.renameSync(this.filePath, quarantinePath);
    } catch (renameErr) {
      // If rename fails, still refuse to overwrite the original path.
      this.state = emptyState();
      this._blockSave = true;
      this.loadError = {
        message: err && err.message ? err.message : String(err),
        quarantinePath: null,
        originalPath: this.filePath,
        renameError: renameErr && renameErr.message ? renameErr.message : String(renameErr)
      };
      return this.state;
    }
    this.state = emptyState();
    this._blockSave = true;
    this.loadError = {
      message: err && err.message ? err.message : String(err),
      quarantinePath,
      originalPath: this.filePath
    };
    return this.state;
  }

  getLoadError() {
    return this.loadError;
  }

  /** Clear the save block after the user acknowledges recovery to an empty store. */
  acknowledgeCorruptRecovery() {
    if (!this._blockSave) return this.state;
    if (this.loadError && !this.loadError.quarantinePath && fs.existsSync(this.filePath)) {
      // The corrupt file could not be moved aside; keep a copy before replacing it.
      fs.copyFileSync(this.filePath, `${this.filePath}.corrupt.${Date.now()}`);
    }
    this._blockSave = false;
    this.loadError = null;
    this.state = emptyState();
    this.saveSync();
    return this.state;
  }

  isSaveBlocked() {
    return Boolean(this._blockSave);
  }

  saveSync() {
    if (this._blockSave) {
      const err = new Error(
        'Store save blocked until corrupt-file recovery is acknowledged'
      );
      this._setSaveError(err);
      throw err;
    }
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      this._setSaveError(err);
      throw err;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    this._dirty = false;
    this._setSaveError(null);
  }

  /** Save shortly; while the disk refuses writes, keep the changes and retry. */
  saveDeferred(delayMs = 200) {
    if (this._blockSave) return;
    this._dirty = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        this.saveSync();
      } catch (_) {
        this.saveDeferred(SAVE_RETRY_MS);
      }
    }, delayMs);
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._blockSave) {
      throw new Error('Store save blocked until corrupt-file recovery is acknowledged');
    }
    this.saveSync();
  }

  getLastSaveError() {
    return this._lastSaveError;
  }

  isDirty() {
    return Boolean(this._dirty) || Boolean(this._saveTimer);
  }

  getSettings() {
    return this.state.settings;
  }

  updateSettings(patch) {
    const next = { ...this.state.settings, ...patch };
    if (patch && patch.shortcuts) {
      next.shortcuts = { ...defaultShortcuts(), ...this.state.settings.shortcuts, ...patch.shortcuts };
    }
    if (patch && patch.defaultOpacity != null) {
      next.defaultOpacity = clamp(Number(patch.defaultOpacity), 0.25, 1);
    }
    if (patch && patch.defaultFontSize != null) {
      next.defaultFontSize = clamp(Number(patch.defaultFontSize), 10, 28);
    }
    if (patch && patch.recentNoteIds) {
      next.recentNoteIds = Array.isArray(patch.recentNoteIds)
        ? patch.recentNoteIds.map(String).slice(0, 12)
        : next.recentNoteIds;
    }
    if (patch && patch.sortBy) {
      next.sortBy = ['updated', 'created', 'title', 'color'].includes(patch.sortBy)
        ? patch.sortBy
        : next.sortBy;
    }
    if (patch && patch.defaultColor && !NOTE_COLORS.some((c) => c.id === patch.defaultColor)) {
      next.defaultColor = this.state.settings.defaultColor;
    }
    if (patch && patch.theme !== undefined && !THEMES.includes(patch.theme)) {
      next.theme = this.state.settings.theme;
    }
    if (patch && patch.managerView !== undefined && !MANAGER_VIEWS.includes(patch.managerView)) {
      next.managerView = this.state.settings.managerView;
    }
    if (patch && patch.shortcutScopes) {
      next.shortcutScopes = normalizeScopes({ ...this.state.settings.shortcutScopes, ...patch.shortcutScopes });
    }
    this.state.settings = next;
    this.saveDeferred();
    return this.state.settings;
  }

  touchRecent(noteId) {
    if (!noteId) return;
    const ids = [noteId, ...(this.state.settings.recentNoteIds || []).filter((id) => id !== noteId)];
    this.state.settings.recentNoteIds = ids.slice(0, 12);
    this.saveDeferred();
  }

  recentNotes(limit = 8) {
    const ids = this.state.settings.recentNoteIds || [];
    const out = [];
    for (const id of ids) {
      const n = this.getNote(id);
      if (n && !n.trashedAt) out.push(n);
      if (out.length >= limit) break;
    }
    return out;
  }

  listWorkspaces() {
    return this.state.workspaces.slice();
  }

  getActiveWorkspaceId() {
    return this.state.activeWorkspaceId;
  }

  setActiveWorkspace(id) {
    if (!this.state.workspaces.some((w) => w.id === id)) return null;
    this.state.activeWorkspaceId = id;
    this.saveDeferred();
    return id;
  }

  createWorkspace(name) {
    const ws = {
      id: createId('ws'),
      name: String(name || 'New workspace').trim() || 'New workspace',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.state.workspaces.push(ws);
    this.saveDeferred();
    return ws;
  }

  renameWorkspace(id, name) {
    const ws = this.state.workspaces.find((w) => w.id === id);
    if (!ws) return null;
    ws.name = String(name || '').trim() || ws.name;
    ws.updatedAt = nowIso();
    this.saveDeferred();
    return ws;
  }

  /** Delete a workspace; its notes move to the trash in the first remaining workspace. */
  deleteWorkspace(id) {
    if (this.state.workspaces.length <= 1) return false;
    const idx = this.state.workspaces.findIndex((w) => w.id === id);
    if (idx < 0) return false;
    this.state.workspaces.splice(idx, 1);
    const fallback = this.state.workspaces[0].id;
    const stamp = nowIso();
    for (const note of this.state.notes) {
      if (note.workspaceId !== id) continue;
      note.workspaceId = fallback;
      if (!note.trashedAt) note.trashedAt = stamp;
      note.visible = false;
    }
    this._forgetRecent((nid) => !this.getNote(nid) || Boolean(this.getNote(nid).trashedAt));
    if (this.state.activeWorkspaceId === id) {
      this.state.activeWorkspaceId = fallback;
    }
    this.saveDeferred();
    return true;
  }

  _forgetRecent(shouldForget) {
    this.state.settings.recentNoteIds = (this.state.settings.recentNoteIds || []).filter(
      (nid) => !shouldForget(nid)
    );
  }

  /** Notes outside the trash, or only trashed notes with `{ trashed: true }`. */
  listNotes(filter = {}) {
    let notes = this.state.notes.filter((n) => Boolean(n.trashedAt) === Boolean(filter.trashed));
    if (filter.workspaceId) {
      notes = notes.filter((n) => n.workspaceId === filter.workspaceId);
    }
    if (filter.tag) {
      const tag = String(filter.tag).toLowerCase();
      notes = notes.filter((n) => n.tags.some((t) => t.toLowerCase() === tag));
    }
    if (filter.visible === true) notes = notes.filter((n) => n.visible);
    if (filter.visible === false) notes = notes.filter((n) => !n.visible);
    if (filter.query) {
      const q = String(filter.query).toLowerCase();
      notes = notes.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return sortNotes(notes, filter.sortBy || this.state.settings.sortBy || 'updated');
  }

  getNote(id) {
    return this.state.notes.find((n) => n.id === id) || null;
  }

  allTags(workspaceId) {
    const set = new Set();
    for (const n of this.state.notes) {
      if (n.trashedAt || (workspaceId && n.workspaceId !== workspaceId)) continue;
      for (const t of n.tags) set.add(String(t).toLowerCase());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  createNote(options = {}) {
    const template = TEMPLATES[options.templateId] || TEMPLATES.blank;
    const workspaceId =
      options.workspaceId || this.state.activeWorkspaceId || this.state.workspaces[0].id;
    const note = createNoteRecord(
      {
        workspaceId,
        title: options.title != null ? options.title : template.title,
        content: options.content != null ? options.content : template.content,
        tags: options.tags || [],
        color: options.color,
        opacity: options.opacity,
        fontSize: options.fontSize,
        monospace: options.monospace,
        bounds: options.bounds,
        displayId: options.displayId,
        visible: options.visible !== false
      },
      this.state.settings
    );
    this.state.notes.push(note);
    this.touchRecent(note.id);
    this.saveDeferred();
    return note;
  }

  updateNote(id, patch) {
    const note = this.getNote(id);
    if (!note) return null;
    const textBefore = JSON.stringify([note.title, note.content, note.tags]);
    const allowed = [
      'title',
      'content',
      'tags',
      'color',
      'opacity',
      'fontSize',
      'monospace',
      'pinned',
      'clickThrough',
      'previewMode',
      'collapsed',
      'visible',
      'bounds',
      'displayId',
      'workspaceId'
    ];
    for (const key of allowed) {
      if (patch[key] === undefined) continue;
      if (key === 'bounds') note.bounds = normalizeBounds(patch.bounds);
      else if (key === 'opacity') note.opacity = clamp(Number(patch.opacity), 0.25, 1);
      else if (key === 'fontSize') note.fontSize = clamp(Number(patch.fontSize), 10, 28);
      else if (key === 'tags') note.tags = normalizeTags(patch.tags);
      else if (key === 'title') note.title = clampTitle(patch.title);
      else if (key === 'content') note.content = clampContent(patch.content);
      else if (key === 'workspaceId') {
        if (this.state.workspaces.some((w) => w.id === patch.workspaceId)) {
          note.workspaceId = patch.workspaceId;
        }
      } else if (key === 'color') {
        if (NOTE_COLORS.some((c) => c.id === patch.color)) {
          note.color = patch.color;
        }
      } else if (
        key === 'monospace' ||
        key === 'pinned' ||
        key === 'clickThrough' ||
        key === 'previewMode' ||
        key === 'collapsed' ||
        key === 'visible'
      ) {
        note[key] = Boolean(patch[key]);
      } else {
        note[key] = patch[key];
      }
    }
    // Window geometry, visibility, and styling are not edits: only text changes
    // move a note's "edited" time and its place in the recent list.
    if (JSON.stringify([note.title, note.content, note.tags]) !== textBefore) {
      note.updatedAt = nowIso();
      this.touchRecent(id);
    }
    this.saveDeferred();
    return note;
  }

  /** Permanently remove a note. */
  deleteNote(id) {
    const idx = this.state.notes.findIndex((n) => n.id === id);
    if (idx < 0) return false;
    this.state.notes.splice(idx, 1);
    this._forgetRecent((nid) => nid === id);
    this.saveDeferred();
    return true;
  }

  /** Move a note to the trash. It stays recoverable until the trash is emptied or purged. */
  trashNote(id) {
    const note = this.getNote(id);
    if (!note || note.trashedAt) return null;
    note.trashedAt = nowIso();
    note.visible = false;
    this._forgetRecent((nid) => nid === id);
    this.saveDeferred();
    return note;
  }

  /** Bring a note back from the trash, into an existing workspace, still hidden. */
  restoreNote(id) {
    const note = this.getNote(id);
    if (!note || !note.trashedAt) return null;
    note.trashedAt = null;
    if (!this.state.workspaces.some((w) => w.id === note.workspaceId)) {
      note.workspaceId = this.state.activeWorkspaceId;
    }
    this.saveDeferred();
    return note;
  }

  emptyTrash() {
    const before = this.state.notes.length;
    this.state.notes = this.state.notes.filter((n) => !n.trashedAt);
    const removed = before - this.state.notes.length;
    if (removed) this.saveDeferred();
    return removed;
  }

  /** Permanently delete notes that have been in the trash longer than `days`. */
  purgeTrash(days = TRASH_DAYS, now = Date.now()) {
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    const before = this.state.notes.length;
    this.state.notes = this.state.notes.filter((n) => !n.trashedAt || Date.parse(n.trashedAt) > cutoff);
    const removed = before - this.state.notes.length;
    if (removed) this.saveDeferred();
    return removed;
  }

  hideNote(id) {
    return this.updateNote(id, { visible: false });
  }

  showNote(id) {
    return this.updateNote(id, { visible: true });
  }

  bulkSetVisible(ids, visible) {
    let count = 0;
    for (const id of ids || []) {
      if (this.getNote(id)) {
        this.updateNote(id, { visible: Boolean(visible) });
        count += 1;
      }
    }
    return count;
  }

  exportAll() {
    const images = {};
    for (const name of this.referencedImages()) {
      const file = this.imagePath(name);
      if (file && fs.existsSync(file)) images[name] = fs.readFileSync(file).toString('base64');
    }
    return {
      exportedAt: nowIso(),
      app: 'ghost-notetaker',
      activeWorkspaceId: this.state.activeWorkspaceId,
      version: STORE_VERSION,
      workspaces: this.state.workspaces,
      notes: this.state.notes,
      settings: this.state.settings,
      images
    };
  }

  // ---------- backups ----------

  get backupDir() {
    return path.join(path.dirname(this.filePath), 'backups');
  }

  /** Newest first: [{ name, size, modifiedAt }]. */
  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs
      .readdirSync(this.backupDir)
      .filter((name) => BACKUP_NAME.test(name))
      .map((name) => {
        const stat = fs.statSync(path.join(this.backupDir, name));
        return { name, size: stat.size, modifiedAt: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
      .map(({ mtimeMs, ...rest }) => rest);
  }

  /**
   * Copy the notes file into backups/. Without `force`, at most one copy per
   * calendar day is made; the newest `keep` copies are kept.
   */
  createBackup({ force = false, now = new Date(), keep = BACKUP_KEEP } = {}) {
    if (this._blockSave || !fs.existsSync(this.filePath)) return null;
    const { day, time } = localStamp(now);
    const existing = this.listBackups();
    if (!force && existing.some((b) => b.name.startsWith(`ghost-notetaker-${day}`))) return null;
    fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    const name = force ? `ghost-notetaker-${day}-${time}.json` : `ghost-notetaker-${day}.json`;
    const target = path.join(this.backupDir, name);
    fs.copyFileSync(this.filePath, target);
    fs.chmodSync(target, 0o600);
    for (const old of this.listBackups().slice(keep)) {
      fs.rmSync(path.join(this.backupDir, old.name), { force: true });
    }
    return name;
  }

  readBackup(name) {
    if (typeof name !== 'string' || !BACKUP_NAME.test(name)) throw new Error('Unknown backup');
    const file = path.join(this.backupDir, name);
    if (!fs.existsSync(file)) throw new Error('That backup no longer exists');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  // ---------- images ----------

  get imageDir() {
    return path.join(path.dirname(this.filePath), 'images');
  }

  imagePath(name) {
    return typeof name === 'string' && IMAGE_NAME.test(name) ? path.join(this.imageDir, name) : null;
  }

  /** Store an image file and return its name. Only PNG, JPEG, GIF, and WebP up to 10 MB. */
  saveImage(buffer) {
    const type = imageType(buffer);
    if (!type) throw new Error('Only PNG, JPEG, GIF, and WebP images can be added');
    if (buffer.length > IMAGE_MAX_BYTES) throw new Error('Images can be at most 10 MB');
    fs.mkdirSync(this.imageDir, { recursive: true, mode: 0o700 });
    const name = `${crypto.randomBytes(8).toString('hex')}.${type}`;
    fs.writeFileSync(path.join(this.imageDir, name), buffer, { mode: 0o600, flag: 'wx' });
    return name;
  }

  /** Names of images referenced by any note, including notes in the trash. */
  referencedImages() {
    const names = new Set();
    for (const note of this.state.notes) {
      for (const match of String(note.content).matchAll(IMAGE_REF)) names.add(match[1]);
    }
    return names;
  }

  /**
   * Delete image files that no note and no backup refers to. Files newer than
   * `minAgeMs` are kept, because a pasted image is stored a moment before the
   * note text that refers to it is saved.
   */
  collectImageGarbage({ minAgeMs = IMAGE_GRACE_MS, now = Date.now() } = {}) {
    if (!fs.existsSync(this.imageDir)) return 0;
    const keep = this.referencedImages();
    for (const backup of this.listBackups()) {
      const text = fs.readFileSync(path.join(this.backupDir, backup.name), 'utf8');
      for (const match of text.matchAll(IMAGE_REF)) keep.add(match[1]);
    }
    let removed = 0;
    for (const name of fs.readdirSync(this.imageDir)) {
      if (!IMAGE_NAME.test(name) || keep.has(name)) continue;
      const file = path.join(this.imageDir, name);
      if (now - fs.statSync(file).mtimeMs < minAgeMs) continue;
      fs.rmSync(file, { force: true });
      removed += 1;
    }
    return removed;
  }

  _importImages(images) {
    if (images == null) return;
    if (typeof images !== 'object' || Array.isArray(images)) throw new Error('Invalid images');
    for (const [name, data] of Object.entries(images)) {
      const file = this.imagePath(name);
      if (!file || typeof data !== 'string') throw new Error('Invalid image in backup');
      const buffer = Buffer.from(data, 'base64');
      if (imageType(buffer) !== name.split('.').pop() || buffer.length > IMAGE_MAX_BYTES) {
        throw new Error('Invalid image in backup');
      }
      if (fs.existsSync(file)) continue;
      fs.mkdirSync(this.imageDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, buffer, { mode: 0o600 });
    }
  }

  importAll(payload, mode = 'merge') {
    if (this._blockSave) throw new Error('Store recovery required before importing');
    if (!['merge', 'replace'].includes(mode)) throw new Error('Invalid import mode');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid import payload');
    validateBackupRecords(payload);
    const previous = structuredClone(this.state);
    const wasDirty = this._dirty;
    try {
      this._importImages(payload.images);
      const result = this._importAll(payload, mode);
      this.flush();
      return result;
    } catch (error) {
      this.state = previous;
      this._dirty = wasDirty;
      // flush() cancelled any pending save; reschedule it, or, when nothing was
      // pending, the file on disk already matches the restored state.
      if (wasDirty) this.saveDeferred(SAVE_RETRY_MS);
      else this._setSaveError(null);
      throw error;
    }
  }

  _importAll(payload, mode) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Invalid import payload');
    }
    if (payload.notes != null && !Array.isArray(payload.notes)) {
      throw new Error('Import notes must be an array');
    }
    if (payload.workspaces != null && !Array.isArray(payload.workspaces)) {
      throw new Error('Import workspaces must be an array');
    }
    const incomingNotes = Array.isArray(payload.notes) ? payload.notes : [];
    const incomingWs = Array.isArray(payload.workspaces) ? payload.workspaces : [];

    if (mode === 'replace') {
      // Keep the app's current protection policy; never silently adopt imported off.
      const keepProtection = this.state.settings.contentProtection !== false;
      const importedProtectionOff =
        payload.settings &&
        typeof payload.settings === 'object' &&
        payload.settings.contentProtection === false;
      const migrated = migrate({
        workspaces: incomingWs.length ? incomingWs : undefined,
        notes: incomingNotes,
        settings: payload.settings,
        activeWorkspaceId: payload.activeWorkspaceId
      });
      // Force notes hidden so they open under the current protection policy when the user chooses.
      migrated.notes = migrated.notes.map((n) => ({ ...n, visible: false }));
      migrated.settings.contentProtection = keepProtection;
      this.state = migrated;
      this.saveDeferred();
      return {
        imported: this.state.notes.length,
        mode: 'replace',
        notesHidden: true,
        protectionPreserved: true,
        importedProtectionOff: Boolean(importedProtectionOff),
        warning: importedProtectionOff
          ? 'Imported backup had content protection off; app protection policy was preserved and notes were left hidden.'
          : 'Replace import left notes hidden so they open under the current protection policy.'
      };
    }

    const wsIdMap = new Map();
    for (const w of incomingWs) {
      const existing = this.state.workspaces.find((x) => x.id === w.id || x.name === w.name);
      if (existing) {
        if (w.id) wsIdMap.set(w.id, existing.id);
      } else {
        const created = this.createWorkspace(w.name || 'Imported');
        if (w.id) wsIdMap.set(w.id, created.id);
      }
    }

    let imported = 0;
    const collisions = [];
    for (const n of incomingNotes) {
      const workspaceId =
        wsIdMap.get(n.workspaceId) ||
        (this.state.workspaces.some((w) => w.id === n.workspaceId)
          ? n.workspaceId
          : this.state.activeWorkspaceId);
      const wantedId = n.id && typeof n.id === 'string' ? n.id : null;
      const existing = wantedId ? this.getNote(wantedId) : null;
      // Preserve both on ID collision: keep local note, assign a fresh id to the import.
      const id = existing ? createId('note') : wantedId || createId('note');
      if (existing) {
        collisions.push({ importedId: wantedId, localId: existing.id, newId: id });
      }
      this.state.notes.push(
        createNoteRecord(
          {
            ...n,
            workspaceId,
            visible: false,
            id
          },
          this.state.settings
        )
      );
      imported += 1;
    }
    this.saveDeferred();
    return {
      imported,
      mode: 'merge',
      collisions,
      warning:
        collisions.length > 0
          ? `${collisions.length} note id collision(s): local notes kept; imported copies got new ids.`
          : undefined
    };
  }

  duplicateNote(id) {
    const src = this.getNote(id);
    if (!src) return null;
    const note = createNoteRecord(
      {
        workspaceId: src.workspaceId,
        title: `${src.title || 'Untitled'} (copy)`,
        content: src.content,
        tags: src.tags.slice(),
        color: src.color,
        opacity: src.opacity,
        fontSize: src.fontSize,
        monospace: src.monospace,
        pinned: src.pinned,
        clickThrough: false,
        previewMode: false,
        visible: true,
        bounds: {
          x: (src.bounds.x || 0) + 28,
          y: (src.bounds.y || 0) + 28,
          width: src.bounds.width,
          height: src.bounds.height
        },
        displayId: src.displayId
      },
      this.state.settings
    );
    this.state.notes.push(note);
    this.touchRecent(note.id);
    this.saveDeferred();
    return note;
  }

  /** The note as a standalone Markdown file; app images are embedded as data URIs. */
  noteToMarkdown(id) {
    const note = this.getNote(id);
    if (!note) return null;
    const tags = note.tags.length ? `\n\n<!-- tags: ${note.tags.join(', ')} -->` : '';
    const content = note.content.replace(IMAGE_REF, (ref, name) => {
      const file = this.imagePath(name);
      if (!file || !fs.existsSync(file)) return ref;
      return `data:${IMAGE_MIME[name.split('.').pop()]};base64,${fs.readFileSync(file).toString('base64')}`;
    });
    return `# ${note.title}\n\n${content}${tags}\n`;
  }
}

module.exports = {
  Store,
  IMAGE_MIME,
  imageType,
  STORE_VERSION,
  NOTE_COLORS,
  TEMPLATES,
  TITLE_MAX,
  CONTENT_MAX,
  TAG_MAX_LEN,
  TAG_MAX_COUNT,
  defaultShortcuts,
  defaultSettings,
  createNoteRecord,
  emptyState,
  migrate,
  createId,
  clamp,
  clampTitle,
  clampContent,
  normalizeTags,
  normalizeBounds,
  sortNotes
};
