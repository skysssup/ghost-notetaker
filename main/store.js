'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_VERSION = 1;

const NOTE_COLORS = [
  { id: 'mist', hex: '#c8d6e5', label: 'Mist' },
  { id: 'lavender', hex: '#a29bfe', label: 'Lavender' },
  { id: 'mint', hex: '#55efc4', label: 'Mint' },
  { id: 'peach', hex: '#fdcb6e', label: 'Peach' },
  { id: 'rose', hex: '#fd79a8', label: 'Rose' },
  { id: 'sky', hex: '#74b9ff', label: 'Sky' },
  { id: 'slate', hex: '#636e72', label: 'Slate' },
  { id: 'ivory', hex: '#f5f6fa', label: 'Ivory' }
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
  demo: {
    id: 'demo',
    label: 'Demo talking points',
    title: 'Demo talking points',
    content: [
      '# Demo walkthrough',
      '',
      '## Opening',
      '- Context / problem',
      '- What we built',
      '',
      '## Flow',
      '1. Step one',
      '2. Step two',
      '3. Step three',
      '',
      '## Talking points',
      '- Key design choice',
      '- Trade-offs',
      '',
      '## Q&A reminders',
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
  }
};

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
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

function emptyState() {
  const ws = defaultWorkspace();
  return {
    version: STORE_VERSION,
    activeWorkspaceId: ws.id,
    workspaces: [ws],
    notes: [],
    settings: {
      globalClickThrough: false,
      shortcuts: defaultShortcuts()
    }
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

function defaultNoteBounds() {
  return { x: 120, y: 120, width: 340, height: 280 };
}

function createNoteRecord(partial = {}) {
  const stamp = nowIso();
  return {
    id: partial.id || createId('note'),
    workspaceId: partial.workspaceId,
    title: partial.title != null ? String(partial.title) : 'Untitled',
    content: partial.content != null ? String(partial.content) : '',
    tags: Array.isArray(partial.tags) ? partial.tags.map(String) : [],
    color: partial.color || 'mist',
    opacity: clamp(partial.opacity != null ? Number(partial.opacity) : 0.88, 0.25, 1),
    fontSize: clamp(partial.fontSize != null ? Number(partial.fontSize) : 14, 10, 28),
    monospace: Boolean(partial.monospace),
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

function normalizeBounds(b) {
  return {
    x: Math.round(Number(b.x) || 0),
    y: Math.round(Number(b.y) || 0),
    width: Math.max(200, Math.round(Number(b.width) || 340)),
    height: Math.max(160, Math.round(Number(b.height) || 280))
  };
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

  if (Array.isArray(raw.notes)) {
    state.notes = raw.notes.map((n) =>
      createNoteRecord({
        ...n,
        workspaceId:
          n.workspaceId && state.workspaces.some((w) => w.id === n.workspaceId)
            ? n.workspaceId
            : state.activeWorkspaceId
      })
    );
  }

  if (raw.settings && typeof raw.settings === 'object') {
    state.settings.globalClickThrough = Boolean(raw.settings.globalClickThrough);
    state.settings.shortcuts = {
      ...defaultShortcuts(),
      ...(raw.settings.shortcuts || {})
    };
  }
  state.version = STORE_VERSION;
  return state;
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = emptyState();
    this._saveTimer = null;
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.state = emptyState();
        this.saveSync();
        return this.state;
      }
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.state = migrate(raw);
      return this.state;
    } catch (err) {
      this.state = emptyState();
      return this.state;
    }
  }

  saveSync() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  saveDeferred(delayMs = 200) {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      try {
        this.saveSync();
      } catch (_) {
        /* ignore disk errors in deferred path */
      }
    }, delayMs);
  }

  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.saveSync();
  }

  getState() {
    return this.state;
  }

  getSettings() {
    return this.state.settings;
  }

  updateSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.saveDeferred();
    return this.state.settings;
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
    if (filter.query) {
      const q = String(filter.query).toLowerCase();
      notes = notes.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    notes.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return notes;
  }

  getNote(id) {
    return this.state.notes.find((n) => n.id === id) || null;
  }

  allTags(workspaceId) {
    const set = new Set();
    for (const n of this.state.notes) {
      if (workspaceId && n.workspaceId !== workspaceId) continue;
      for (const t of n.tags) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  createNote(options = {}) {
    const template = TEMPLATES[options.templateId] || TEMPLATES.blank;
    const workspaceId =
      options.workspaceId || this.state.activeWorkspaceId || this.state.workspaces[0].id;
    const note = createNoteRecord({
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
    });
    this.state.notes.push(note);
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
      else if (key === 'tags') note.tags = Array.isArray(patch.tags) ? patch.tags.map(String) : [];
      else if (
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
    this.saveDeferred();
    return note;
  }

  deleteNote(id) {
    const idx = this.state.notes.findIndex((n) => n.id === id);
    if (idx < 0) return false;
    this.state.notes.splice(idx, 1);
    this.saveDeferred();
    return true;
  }

  hideNote(id) {
    return this.updateNote(id, { visible: false });
  }

  showNote(id) {
    return this.updateNote(id, { visible: true });
  }

  exportAll() {
    return {
      exportedAt: nowIso(),
      app: 'ghost-notetaker',
      version: STORE_VERSION,
      workspaces: this.state.workspaces,
      notes: this.state.notes,
      settings: this.state.settings
    };
  }

  importAll(payload, mode = 'merge') {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid import payload');
    }
    const incomingNotes = Array.isArray(payload.notes) ? payload.notes : [];
    const incomingWs = Array.isArray(payload.workspaces) ? payload.workspaces : [];

    if (mode === 'replace') {
      const migrated = migrate({
        workspaces: incomingWs.length ? incomingWs : undefined,
        notes: incomingNotes,
        settings: payload.settings,
        activeWorkspaceId: payload.activeWorkspaceId
      });
      this.state = migrated;
      this.saveDeferred();
      return { imported: this.state.notes.length, mode: 'replace' };
    }

    const wsIdMap = new Map();
    for (const w of incomingWs) {
      const existing = this.state.workspaces.find((x) => x.id === w.id || x.name === w.name);
      if (existing) {
        wsIdMap.set(w.id, existing.id);
      } else {
        const created = this.createWorkspace(w.name || 'Imported');
        if (w.id) wsIdMap.set(w.id, created.id);
      }
    }

    let imported = 0;
    for (const n of incomingNotes) {
      const workspaceId =
        wsIdMap.get(n.workspaceId) ||
        (this.state.workspaces.some((w) => w.id === n.workspaceId)
          ? n.workspaceId
          : this.state.activeWorkspaceId);
      const existing = this.getNote(n.id);
      if (existing) {
        this.updateNote(n.id, {
          title: n.title,
          content: n.content,
          tags: n.tags,
          color: n.color,
          opacity: n.opacity,
          fontSize: n.fontSize,
          monospace: n.monospace,
          pinned: n.pinned,
          clickThrough: n.clickThrough,
          previewMode: n.previewMode,
          visible: false,
          bounds: n.bounds,
          displayId: n.displayId,
          workspaceId
        });
      } else {
        this.state.notes.push(
          createNoteRecord({
            ...n,
            workspaceId,
            visible: false,
            id: n.id || createId('note')
          })
        );
        imported += 1;
      }
    }
    this.saveDeferred();
    return { imported, mode: 'merge' };
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
  defaultShortcuts,
  createNoteRecord,
  emptyState,
  migrate,
  createId,
  clamp,
  normalizeBounds
};
