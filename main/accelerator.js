'use strict';

/**
 * Pure accelerator helpers — no Electron dependency (safe for unit tests).
 */

const MODIFIER_ORDER = ['CommandOrControl', 'Command', 'Control', 'Super', 'Alt', 'Shift'];
const MODIFIER_ALIASES = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  super: 'Super',
  meta: 'Super',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift'
};
const NAMED_KEYS = ['Space', 'Up', 'Down', 'Left', 'Right'];

function canonicalKey(token) {
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  if (/^[0-9]$/.test(token)) return token;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(token)) return token.toUpperCase();
  return NAMED_KEYS.find((k) => k.toLowerCase() === token.toLowerCase()) || null;
}

/**
 * Validate an accelerator for global registration and return its canonical
 * form ("CommandOrControl+Shift+N"), '' for an intentionally cleared binding,
 * or null when it is not usable. A binding needs exactly one key and at least
 * one modifier other than Shift so it cannot swallow ordinary typing.
 */
function normalizeAccelerator(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > 64) return null;
  const mods = new Set();
  let key = null;
  for (const part of trimmed.split('+').map((p) => p.trim())) {
    const mod = MODIFIER_ALIASES[part.toLowerCase()];
    if (mod) {
      mods.add(mod);
      continue;
    }
    const k = canonicalKey(part);
    if (!k || key) return null;
    key = k;
  }
  if (!key || ![...mods].some((m) => m !== 'Shift')) return null;
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join('+');
}

const MAC_SYMBOLS = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Control: '⌃',
  Super: '⌘',
  Alt: '⌥',
  Shift: '⇧'
};
const PC_NAMES = {
  CommandOrControl: 'Ctrl',
  Command: 'Super',
  Control: 'Ctrl',
  Super: 'Super',
  Alt: 'Alt',
  Shift: 'Shift'
};

/** Human-readable label for an accelerator on the given platform. */
function formatAccelerator(accelerator, platform = process.platform) {
  const canonical = normalizeAccelerator(accelerator);
  if (!canonical) return '';
  const parts = canonical.split('+');
  const key = parts.pop();
  if (platform === 'darwin') {
    const order = ['Control', 'Alt', 'Shift', 'CommandOrControl', 'Command', 'Super'];
    return order.filter((m) => parts.includes(m)).map((m) => MAC_SYMBOLS[m]).join('') + key;
  }
  return [...parts.map((m) => PC_NAMES[m]), key].join('+');
}

const ARROW_KEYS = { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' };

/**
 * Match a webContents `before-input-event` input against an accelerator. Used as
 * the in-window fallback when a global registration is unavailable.
 */
function matchesAccelerator(input, accelerator, platform = process.platform) {
  const canonical = normalizeAccelerator(accelerator);
  if (!canonical || !input) return false;
  const parts = canonical.split('+');
  const keyPart = parts.pop().toLowerCase();
  const isMac = platform === 'darwin';

  const wantPrimary = parts.includes('CommandOrControl');
  const wantMeta = parts.includes('Command') || parts.includes('Super') || (isMac && wantPrimary);
  const wantCtrl = parts.includes('Control') || (!isMac && wantPrimary);
  if (Boolean(input.meta) !== wantMeta) return false;
  if (Boolean(input.control) !== wantCtrl) return false;
  if (Boolean(input.alt) !== parts.includes('Alt')) return false;
  if (Boolean(input.shift) !== parts.includes('Shift')) return false;

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '').toLowerCase();
  if (ARROW_KEYS[keyPart]) return key === ARROW_KEYS[keyPart] || code === ARROW_KEYS[keyPart];
  if (keyPart === 'space') return code === 'space' || key === ' ';
  return key === keyPart || code === `key${keyPart}` || code === `digit${keyPart}` || code === keyPart;
}

const SHORTCUT_ACTIONS = [
  { id: 'newNote', label: 'New note', scope: 'global' },
  { id: 'toggleManager', label: 'Open / hide Notes Manager', scope: 'global' },
  { id: 'hideShowAll', label: 'Hide / show all notes', scope: 'global' },
  { id: 'toggleClickThrough', label: 'Toggle click-through (all notes)', scope: 'global' },
  { id: 'togglePreview', label: 'Toggle reading mode (focused note)', scope: 'local' },
  { id: 'quickCapture', label: 'Quick capture from clipboard', scope: 'global' },
  { id: 'recoveryNewNote', label: 'New note (backup binding)', scope: 'global' }
];

module.exports = {
  normalizeAccelerator,
  formatAccelerator,
  matchesAccelerator,
  SHORTCUT_ACTIONS
};
