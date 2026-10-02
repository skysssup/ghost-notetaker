'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_VERSION = 2;

const NOTE_COLORS = [
  { id: 'mist', hex: '#c8d6e5', label: 'Mist' },
  { id: 'lavender', hex: '#a29bfe', label: 'Lavender' },
  { id: 'mint', hex: '#55efc4', label: 'Mint' },
  { id: 'peach', hex: '#fdcb6e', label: 'Peach' },
  { id: 'rose', hex: '#fd79a8', label: 'Rose' },
  { id: 'sky', hex: '#74b9ff', label: 'Sky' },
  { id: 'slate', hex: '#636e72', label: 'Slate' },
  { id: 'ivory', hex: '#f5f6fa', label: 'Ivory' },
  { id: 'amber', hex: '#f59e0b', label: 'Amber' },
  { id: 'coral', hex: '#ff7675', label: 'Coral' },
  { id: 'teal', hex: '#14b8a6', label: 'Teal' },
  { id: 'indigo', hex: '#818cf8', label: 'Indigo' }
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
    defaultOpacity: 0.88,
    defaultFontSize: 14,
    defaultColor: 'mist',
    defaultMonospace: false,
    sortBy: 'updated',
    recentNoteIds: [],
    shortcuts: defaultShortcuts()
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

function createNoteRecord(partial = {}, settings = null) {
  const stamp = nowIso();
  const defaults = settings || defaultSettings();
  return {
    id: partial.id || createId('note'),
    workspaceId: partial.workspaceId,
    title: clampTitle(partial.title != null ? partial.title : 'Untitled'),
    content: clampContent(partial.content != null ? partial.content : ''),
    tags: normalizeTags(partial.tags),
    color: partial.color || defaults.defaultColor || 'mist',
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
    visible: partial.visible !== false,
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

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = emptyState();
    this._saveTimer = null;
    this._blockSave = false;
    this._dirty = false;
    this._lastSaveError = null;
    this.loadError = null;
  }

  load() {
    this.loadError = null;
    this._blockSave = false;
    this._dirty = false;
    this._lastSaveError = null;
    try {
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
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return this._quarantineCorrupt(new Error('Store root must be a JSON object'));
      }
      if (raw.notes != null && !Array.isArray(raw.notes)) {
        return this._quarantineCorrupt(new Error('Store notes must be an array when present'));
      }
      if (raw.workspaces != null && !Array.isArray(raw.workspaces)) {
        return this._quarantineCorrupt(new Error('Store workspaces must be an array when present'));
      }
      validateBackupRecords(raw);
      this.state = migrate(raw);
      return this.state;
    } catch (err) {
      return this._quarantineCorrupt(err);
    }
  }

  _quarantineCorrupt(err) {
    const stamp = Date.now();
    const quarantinePath = `${this.filePath}.corrupt.${stamp}`;
    try {
      if (fs.existsSync(this.filePath)) {
        fs.renameSync(this.filePath, quarantinePath);
      }
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
      this._lastSaveError = err;
      throw err;
    }
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      this._lastSaveError = err;
      throw err;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    this._dirty = false;
    this._lastSaveError = null;
  }

  saveDeferred(delayMs = 200) {
    if (this._blockSave) return;
    this._dirty = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        this.saveSync();
      } catch (err) {
        this._dirty = true;
        this._lastSaveError = err;
        /* keep dirty; caller can flush()/retry */
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

  getState() {
    return this.state;
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
      if (n) out.push(n);
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

  deleteWorkspace(id) {
    if (this.state.workspaces.length <= 1) return false;
    const idx = this.state.workspaces.findIndex((w) => w.id === id);
    if (idx < 0) return false;
    this.state.workspaces.splice(idx, 1);
    this.state.notes = this.state.notes.filter((n) => n.workspaceId !== id);
    this.state.settings.recentNoteIds = (this.state.settings.recentNoteIds || []).filter((nid) =>
      this.state.notes.some((n) => n.id === nid)
    );
    if (this.state.activeWorkspaceId === id) {
      this.state.activeWorkspaceId = this.state.workspaces[0].id;
    }
    this.saveDeferred();
    return true;
  }

  listNotes(filter = {}) {
    let notes = this.state.notes.slice();
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
      if (workspaceId && n.workspaceId !== workspaceId) continue;
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
        key === 'visible'
      ) {
        note[key] = Boolean(patch[key]);
      } else {
        note[key] = patch[key];
      }
    }
    note.updatedAt = nowIso();
    if (patch.title != null || patch.content != null || patch.tags != null) {
      this.touchRecent(id);
    }
    this.saveDeferred();
    return note;
  }

  deleteNote(id) {
    const idx = this.state.notes.findIndex((n) => n.id === id);
    if (idx < 0) return false;
    this.state.notes.splice(idx, 1);
    this.state.settings.recentNoteIds = (this.state.settings.recentNoteIds || []).filter((x) => x !== id);
    this.saveDeferred();
    return true;
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
    return {
      exportedAt: nowIso(),
      app: 'ghost-notetaker',
      activeWorkspaceId: this.state.activeWorkspaceId,
      version: STORE_VERSION,
      workspaces: this.state.workspaces,
      notes: this.state.notes,
      settings: this.state.settings
    };
  }

  importAll(payload, mode = 'merge') {
    if (this._blockSave) throw new Error('Store recovery required before importing');
    if (!['merge', 'replace'].includes(mode)) throw new Error('Invalid import mode');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid import payload');
    validateBackupRecords(payload);
    const previous = structuredClone(this.state);
    const wasDirty = this._dirty;
    try {
      const result = this._importAll(payload, mode);
      this.flush();
      return result;
    } catch (error) {
      this.state = previous;
      this._dirty = wasDirty;
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

  noteToMarkdown(id) {
    const note = this.getNote(id);
    if (!note) return null;
    const tags = note.tags.length ? `\n\n<!-- tags: ${note.tags.join(', ')} -->` : '';
    return `# ${note.title}\n\n${note.content}${tags}\n`;
  }
}

module.exports = {
  Store,
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
