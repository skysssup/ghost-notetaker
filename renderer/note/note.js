'use strict';

(function () {
  const params = new URLSearchParams(location.search);
  const noteId = params.get('id');
  if (!noteId || !window.ghostNote) {
    document.body.innerHTML =
      '<div role="alert" style="font-family:system-ui,sans-serif;padding:24px">Unable to load note.</div>';
    return;
  }

  const els = {
    shell: document.getElementById('shell'),
    chrome: document.getElementById('chrome'),
    title: document.getElementById('title'),
    editor: document.getElementById('editor'),
    preview: document.getElementById('preview'),
    mdToolbar: document.getElementById('mdToolbar'),
    btnPreview: document.getElementById('btnPreview'),
    btnMono: document.getElementById('btnMono'),
    btnPin: document.getElementById('btnPin'),
    btnGhost: document.getElementById('btnGhost'),
    btnMore: document.getElementById('btnMore'),
    morePanel: document.getElementById('morePanel'),
    palette: document.getElementById('palette'),
    opacity: document.getElementById('opacity'),
    opacityValue: document.getElementById('opacityValue'),
    fontSize: document.getElementById('fontSize'),
    fontSizeValue: document.getElementById('fontSizeValue'),
    btnNew: document.getElementById('btnNew'),
    btnHide: document.getElementById('btnHide'),
    tagChips: document.getElementById('tagChips'),
    tagInput: document.getElementById('tagInput'),
    saveStatus: document.getElementById('saveStatus'),
    modeLabel: document.getElementById('modeLabel')
  };

  const SAVE_FAILED = 'Not saved yet. Your text is kept here and saving is retried.';
  const DISK_FAILED = 'Not written to disk yet. Ghost Notetaker keeps your text and retries.';
  let localSaveFailed = false;
  let diskSaveFailed = false;
  let note = null;
  let colors = [];
  let applying = false;

  function colorHex(id) {
    const c = colors.find((x) => x.id === id);
    return (c && c.hex) || '#c8d6e5';
  }

  function setPressed(btn, on) {
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }

  function setValuePreservingSelection(input, value) {
    if (input.value === value) return;
    const focused = document.activeElement === input;
    const { selectionStart, selectionEnd } = input;
    input.value = value;
    if (focused) {
      const max = value.length;
      input.setSelectionRange(Math.min(selectionStart, max), Math.min(selectionEnd, max));
    }
  }

  function renderTags() {
    els.tagChips.textContent = '';
    (note.tags || []).forEach((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip';
      chip.title = `Remove tag #${tag}`;
      const label = document.createElement('span');
      label.textContent = `#${tag}`;
      const x = document.createElement('span');
      x.className = 'tag-x';
      x.setAttribute('aria-hidden', 'true');
      x.textContent = '×';
      chip.append(label, x);
      chip.addEventListener('click', () => {
        const tags = (note.tags || []).filter((t) => t !== tag);
        queueSave({ tags });
        renderTags();
      });
      els.tagChips.appendChild(chip);
    });
  }

  function applyStyle() {
    const opacityPct = Math.round((note.opacity || 0.88) * 100);
    const fontSize = note.fontSize || 14;
    els.opacity.value = opacityPct;
    els.opacityValue.textContent = `${opacityPct}%`;
    els.fontSize.value = fontSize;
    els.fontSizeValue.textContent = `${fontSize}px`;
    els.shell.style.setProperty('--note-tint', colorHex(note.color));
    els.shell.style.setProperty('--opacity', String(note.opacity || 0.88));
    els.shell.style.setProperty('--font-size', `${fontSize}px`);
    els.shell.classList.toggle('mono', Boolean(note.monospace));
    setPressed(els.btnMono, Boolean(note.monospace));
    setPressed(els.btnPin, note.pinned !== false);
    setPressed(els.btnGhost, Boolean(note.clickThrough));
    for (const swatch of els.palette.children) {
      swatch.setAttribute('aria-checked', String(swatch.dataset.color === note.color));
    }
  }

  /**
   * Show a note pushed from the main process (e.g. edited in the Notes Manager).
   * Local edits that have not been saved yet win over the incoming copy, and
   * the caret stays where it was.
   */
  function applyLocal(incoming) {
    applying = true;
    note = { ...incoming, ...(saveQueue.pendingPatch() || {}) };
    setValuePreservingSelection(els.title, note.title || '');
    setValuePreservingSelection(els.editor, note.content || '');
    applyStyle();
    setPreviewMode(Boolean(note.previewMode));
    renderTags();
    applying = false;
  }

  function setPreviewMode(on) {
    els.editor.classList.toggle('hidden', on);
    els.preview.classList.toggle('hidden', !on);
    els.mdToolbar.classList.toggle('hidden', on);
    els.modeLabel.textContent = on ? 'preview' : 'edit';
    setPressed(els.btnPreview, on);
    const label = on ? 'Back to editing' : 'Markdown preview';
    els.btnPreview.title = label;
    els.btnPreview.setAttribute('aria-label', label);
    els.btnPreview.querySelector('use').setAttribute('href', on ? '#i-edit' : '#i-eye');
    if (on) renderPreview();
  }

  function renderPreview() {
    const md = window.GhostMarkdown;
    els.preview.innerHTML = md.renderMarkdown(els.editor.value);
    els.preview.querySelectorAll('.task-check').forEach((input) => {
      input.addEventListener('change', () => {
        const li = input.closest('[data-task-line]');
        if (!li) return;
        const line = Number(li.getAttribute('data-task-line'));
        const next = md.toggleTaskAtLine(els.editor.value, line);
        els.editor.value = next;
        queueSave({ content: next });
        renderPreview();
      });
    });
    els.preview.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const href = a.getAttribute('href');
        if (href) window.ghostNote.openExternal(href);
      });
    });
  }

  let retryTimer = null;
  const saveQueue = window.GhostSaveQueue.createSaveQueue({
    delayMs: 160,
    flush: async (patch) => {
      clearTimeout(retryTimer);
      try {
        const result = await window.ghostNote.updateNote(noteId, patch);
        if (result && result.__saveError) throw new Error(result.__saveError);
        localSaveFailed = false;
        renderSaveStatus();
        return result;
      } catch (err) {
        localSaveFailed = true;
        renderSaveStatus();
        // The failed patch stays queued; try again shortly even without new typing.
        retryTimer = setTimeout(() => saveQueue.queue({}), 3000);
        throw err;
      }
    }
  });

  function queueSave(patch) {
    if (applying || !note) return;
    Object.assign(note, patch);
    saveQueue.queue(patch);
  }

  function renderSaveStatus() {
    const message = localSaveFailed ? SAVE_FAILED : diskSaveFailed ? DISK_FAILED : '';
    els.saveStatus.hidden = !message;
    els.saveStatus.textContent = message;
    els.shell.classList.toggle('has-error', Boolean(message));
  }

  async function flushNow() {
    try {
      await saveQueue.flushNow();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err && err.message ? err.message : String(err) };
    }
  }

  // Called by the main process (executeJavaScript) before hiding, exporting, or quitting.
  window.__ghostFlushPending = flushNow;

  function buildPalette() {
    els.palette.textContent = '';
    colors.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.color = c.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.label);
      b.style.background = c.hex;
      b.title = c.label;
      b.addEventListener('click', () => {
        queueSave({ color: c.id });
        applyStyle();
      });
      els.palette.appendChild(b);
    });
  }

  function setMoreOpen(open) {
    els.morePanel.classList.toggle('hidden', !open);
    els.btnMore.setAttribute('aria-expanded', String(open));
    els.shell.classList.toggle('panel-open', open);
  }

  /** Replace the selection via the editing pipeline so Ctrl/Cmd+Z can undo it. */
  function replaceRange(start, end, text, selectStart, selectEnd) {
    const ta = els.editor;
    ta.focus();
    ta.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, text)) {
      ta.setRangeText(text, start, end, 'end');
      queueSave({ content: ta.value });
    }
    ta.setSelectionRange(selectStart, selectEnd);
  }

  function wrapSelection(before, after, placeholder) {
    const ta = els.editor;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.slice(start, end) || placeholder || '';
    replaceRange(
      start,
      end,
      before + selected + after,
      start + before.length,
      start + before.length + selected.length
    );
  }

  function prefixLines(prefix) {
    const ta = els.editor;
    const value = ta.value;
    const lineStart = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    const lineEnd = value.indexOf('\n', ta.selectionEnd);
    const sliceEnd = lineEnd === -1 ? value.length : lineEnd;
    const block = value
      .slice(lineStart, sliceEnd)
      .split('\n')
      .map((line) => (line.startsWith(prefix) ? line : prefix + line))
      .join('\n');
    replaceRange(lineStart, sliceEnd, block, lineStart, lineStart + block.length);
  }

  function insertAtCursor(text) {
    const ta = els.editor;
    const pos = ta.selectionStart + text.length;
    replaceRange(ta.selectionStart, ta.selectionEnd, text, pos, pos);
  }

  const MD_ACTIONS = {
    h2: () => prefixLines('## '),
    bold: () => wrapSelection('**', '**', 'bold'),
    italic: () => wrapSelection('*', '*', 'italic'),
    strike: () => wrapSelection('~~', '~~', 'struck'),
    code: () => wrapSelection('`', '`', 'code'),
    link: () => wrapSelection('[', '](https://)', 'label'),
    ul: () => prefixLines('- '),
    ol: () => prefixLines('1. '),
    task: () => prefixLines('- [ ] '),
    quote: () => prefixLines('> '),
    hr: () => insertAtCursor('\n---\n')
  };

  els.mdToolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-md]');
    if (!btn || !note || note.previewMode) return;
    const action = MD_ACTIONS[btn.getAttribute('data-md')];
    if (action) action();
  });

  let chromeHover = false;
  function setChromeHover(on) {
    if (chromeHover === on) return;
    chromeHover = on;
    window.ghostNote.chromeHover(noteId, on);
  }

  for (const el of [els.chrome, els.mdToolbar]) {
    el.addEventListener('mouseenter', () => setChromeHover(true));
    el.addEventListener('mouseleave', () => setChromeHover(false));
  }

  els.title.addEventListener('input', () => queueSave({ title: els.title.value }));
  els.editor.addEventListener('input', () => queueSave({ content: els.editor.value }));

  els.opacity.addEventListener('input', () => {
    queueSave({ opacity: Number(els.opacity.value) / 100 });
    applyStyle();
  });

  els.fontSize.addEventListener('input', () => {
    queueSave({ fontSize: Number(els.fontSize.value) });
    applyStyle();
  });

  els.btnPreview.addEventListener('click', () => {
    const previewMode = !note.previewMode;
    queueSave({ previewMode });
    setPreviewMode(previewMode);
  });

  els.btnMono.addEventListener('click', () => {
    queueSave({ monospace: !note.monospace });
    applyStyle();
  });

  els.btnPin.addEventListener('click', () => {
    queueSave({ pinned: !note.pinned });
    applyStyle();
  });

  els.btnGhost.addEventListener('click', async () => {
    const clickThrough = !note.clickThrough;
    await window.ghostNote.setClickThrough(noteId, clickThrough);
    note.clickThrough = clickThrough;
    applyStyle();
  });

  els.btnMore.addEventListener('click', (e) => {
    e.stopPropagation();
    setMoreOpen(els.morePanel.classList.contains('hidden'));
  });

  document.addEventListener('click', (e) => {
    if (!els.morePanel.contains(e.target) && !els.btnMore.contains(e.target)) setMoreOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.morePanel.classList.contains('hidden')) {
      setMoreOpen(false);
      els.btnMore.focus();
    }
  });

  els.btnNew.addEventListener('click', () => {
    setMoreOpen(false);
    window.ghostNote.createNote({ templateId: 'blank' });
  });

  els.btnHide.addEventListener('click', async () => {
    const saved = await flushNow();
    if (!saved.ok) return;
    try {
      await window.ghostNote.hideNote(noteId);
    } catch (_) {
      localSaveFailed = true;
      renderSaveStatus();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (saveQueue.hasPending()) saveQueue.flushNow().catch(() => {});
  });

  function addTagFromInput() {
    const raw = els.tagInput.value
      .trim()
      .replace(/^#+/, '')
      .toLowerCase()
      .slice(0, 32);
    els.tagInput.value = '';
    if (!raw) return;
    const tags = Array.from(new Set([...(note.tags || []), raw]));
    queueSave({ tags });
    renderTags();
  }

  els.tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTagFromInput();
    } else if (e.key === 'Backspace' && !els.tagInput.value && (note.tags || []).length) {
      queueSave({ tags: note.tags.slice(0, -1) });
      renderTags();
    }
  });
  els.tagInput.addEventListener('blur', () => {
    if (els.tagInput.value.trim()) addTagFromInput();
  });

  els.editor.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const action = { b: 'bold', i: 'italic', k: 'link' }[e.key.toLowerCase()];
    if (!action) return;
    e.preventDefault();
    MD_ACTIONS[action]();
  });

  window.ghostNote.onUpdated((n) => {
    if (n && n.id === noteId && note) applyLocal(n);
  });

  window.ghostNote.onSaveState((state) => {
    diskSaveFailed = !state.ok;
    renderSaveStatus();
  });

  function showSafeError(title, detail) {
    const box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.className = 'load-error';
    const h = document.createElement('h1');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = String(detail || 'Something went wrong.').slice(0, 400);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Your notes file was not modified by this window.';
    box.append(h, p, hint);
    document.body.replaceChildren(box);
  }

  async function init() {
    const boot = await window.ghostNote.getBootstrap();
    colors = boot.colors || [];
    buildPalette();
    diskSaveFailed = Boolean(boot.saveError);
    renderSaveStatus();
    if (!boot.capabilities.clickThroughHover) {
      els.btnGhost.title =
        'Click-through: clicks pass through this note. On Linux, turn it off from the Notes Manager or the tray menu.';
    }
    const n = await window.ghostNote.getNote(noteId);
    if (!n) {
      showSafeError('Note not found', 'This note is missing from the notes file.');
      return;
    }
    applyLocal(n);
  }

  init().catch((err) => {
    console.error(err);
    showSafeError('Unable to open note', err && err.message ? err.message : err);
  });
})();
