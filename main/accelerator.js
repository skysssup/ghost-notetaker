'use strict';

/**
 * Pure accelerator matching — no Electron dependency (safe for unit tests).
 */
function matchesAccelerator(input, accelerator) {
  const parts = String(accelerator)
    .toLowerCase()
    .split('+')
    .map((p) => p.trim());
  const needCtrl =
    parts.includes('commandorcontrol') ||
    parts.includes('control') ||
    parts.includes('ctrl') ||
    parts.includes('cmd') ||
    parts.includes('command');
  const needAlt = parts.includes('alt') || parts.includes('option');
  const needShift = parts.includes('shift');
  const needMetaOnly =
    (parts.includes('command') ||
      parts.includes('cmd') ||
      parts.includes('super') ||
      parts.includes('meta')) &&
    !parts.includes('commandorcontrol');

  const keyPart = parts.filter(
    (p) =>
      ![
        'commandorcontrol',
        'control',
        'ctrl',
        'command',
        'cmd',
        'alt',
        'option',
        'shift',
        'super',
        'meta'
      ].includes(p)
  )[0];

  if (!keyPart) return false;

  const altPressed = Boolean(input.alt);
  const shiftPressed = Boolean(input.shift);

  if (needCtrl) {
    if (process.platform === 'darwin') {
      if (!input.meta && !input.control) return false;
    } else if (!input.control) {
      return false;
    }
  } else if (needMetaOnly && !input.meta) {
    return false;
  } else if (!needCtrl && !needMetaOnly) {
    if (input.control || input.meta) return false;
  }

  if (needAlt !== altPressed) return false;
  if (needShift !== shiftPressed) return false;

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '').toLowerCase();
  if (key === keyPart || code === `key${keyPart}` || code === keyPart) return true;
  if (keyPart.length === 1 && key === keyPart) return true;
  return false;
}

const SHORTCUT_ACTIONS = [
  { id: 'newNote', label: 'New note', scope: 'global' },
  { id: 'toggleManager', label: 'Open / focus Notes Manager', scope: 'global' },
  { id: 'hideShowAll', label: 'Hide / show all notes', scope: 'global' },
  { id: 'toggleClickThrough', label: 'Toggle click-through (all notes)', scope: 'global' },
  { id: 'togglePreview', label: 'Toggle markdown preview (focused note)', scope: 'local' },
  { id: 'quickCapture', label: 'Quick capture from clipboard', scope: 'global' },
  { id: 'recoveryNewNote', label: 'Recovery: new note', scope: 'global' }
];

module.exports = { matchesAccelerator, SHORTCUT_ACTIONS };
