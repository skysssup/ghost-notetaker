'use strict';

const {
  TITLE_MAX,
  CONTENT_MAX,
  TAG_MAX_COUNT,
  TAG_MAX_LEN,
  NOTE_COLORS,
  defaultShortcuts,
  clamp,
  normalizeTags
} = require('./store');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function requireId(id, label = 'id') {
  if (!isNonEmptyString(id) || id.length > 128) {
    throw new Error(`Invalid ${label}`);
  }
  return id;
}

function optionalId(id, label = 'id') {
  if (id == null || id === '') return null;
  return requireId(id, label);
}

/** Whitelist + clamp fields that renderers may send over IPC. */
function sanitizeNotePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return {};
  }
  const out = {};
  if (patch.title !== undefined) out.title = String(patch.title).slice(0, TITLE_MAX);
  if (patch.content !== undefined) out.content = String(patch.content).slice(0, CONTENT_MAX);
  if (patch.tags !== undefined) out.tags = normalizeTags(patch.tags);
  if (patch.color !== undefined && NOTE_COLORS.some((c) => c.id === patch.color)) {
    out.color = patch.color;
  }
  if (patch.opacity !== undefined) out.opacity = clamp(Number(patch.opacity), 0.25, 1);
  if (patch.fontSize !== undefined) out.fontSize = clamp(Number(patch.fontSize), 10, 28);
  if (patch.monospace !== undefined) out.monospace = Boolean(patch.monospace);
  if (patch.pinned !== undefined) out.pinned = Boolean(patch.pinned);
  if (patch.clickThrough !== undefined) out.clickThrough = Boolean(patch.clickThrough);
  if (patch.previewMode !== undefined) out.previewMode = Boolean(patch.previewMode);
  if (patch.visible !== undefined) out.visible = Boolean(patch.visible);
  if (patch.workspaceId !== undefined && isNonEmptyString(patch.workspaceId)) {
    out.workspaceId = patch.workspaceId;
  }
  if (patch.bounds && typeof patch.bounds === 'object') {
    out.bounds = patch.bounds;
  }
  if (patch.displayId !== undefined) {
    out.displayId = patch.displayId == null ? null : patch.displayId;
  }
  return out;
}

function sanitizeCreateOptions(options) {
  if (!options || typeof options !== 'object') return {};
  const out = {};
  if (options.templateId !== undefined) out.templateId = String(options.templateId).slice(0, 64);
  if (options.title !== undefined) out.title = String(options.title).slice(0, TITLE_MAX);
  if (options.content !== undefined) out.content = String(options.content).slice(0, CONTENT_MAX);
  if (options.tags !== undefined) out.tags = normalizeTags(options.tags);
  if (options.color !== undefined && NOTE_COLORS.some((c) => c.id === options.color)) {
    out.color = options.color;
  }
  if (options.workspaceId !== undefined && isNonEmptyString(options.workspaceId)) {
    out.workspaceId = options.workspaceId;
  }
  if (options.bounds && typeof options.bounds === 'object') out.bounds = options.bounds;
  if (options.displayId !== undefined) out.displayId = options.displayId;
  if (options.visible !== undefined) out.visible = Boolean(options.visible);
  return out;
}

const SETTINGS_BOOL = ['globalClickThrough', 'contentProtection', 'launchAtLogin', 'defaultMonospace'];
const SORT_KEYS = ['updated', 'created', 'title', 'color'];

function sanitizeSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return {};
  }
  const out = {};
  for (const key of SETTINGS_BOOL) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      out[key] = Boolean(patch[key]);
    }
  }
  if (patch.defaultOpacity != null) {
    out.defaultOpacity = clamp(Number(patch.defaultOpacity), 0.25, 1);
  }
  if (patch.defaultFontSize != null) {
    out.defaultFontSize = clamp(Number(patch.defaultFontSize), 10, 28);
  }
  if (patch.defaultColor && NOTE_COLORS.some((c) => c.id === patch.defaultColor)) {
    out.defaultColor = patch.defaultColor;
  }
  if (patch.sortBy && SORT_KEYS.includes(patch.sortBy)) {
    out.sortBy = patch.sortBy;
  }
  if (patch.shortcuts && typeof patch.shortcuts === 'object') {
    const allowed = Object.keys(defaultShortcuts());
    const next = {};
    for (const key of allowed) {
      if (typeof patch.shortcuts[key] === 'string' && patch.shortcuts[key].length <= 64) {
        next[key] = patch.shortcuts[key];
      }
    }
    if (Object.keys(next).length) out.shortcuts = next;
  }
  if (Array.isArray(patch.recentNoteIds)) {
    out.recentNoteIds = patch.recentNoteIds
      .filter((id) => typeof id === 'string' && id.length <= 128)
      .slice(0, 12);
  }
  return out;
}

function sanitizeIdList(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 128).slice(0, 500);
}

module.exports = {
  requireId,
  optionalId,
  sanitizeNotePatch,
  sanitizeCreateOptions,
  sanitizeSettingsPatch,
  sanitizeIdList,
  TITLE_MAX,
  CONTENT_MAX,
  TAG_MAX_COUNT,
  TAG_MAX_LEN
};
