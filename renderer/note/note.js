'use strict';

(function () {
  const params = new URLSearchParams(location.search);
  const noteId = params.get('id');
  if (!noteId || !window.ghostNote) {
    document.body.innerHTML =
      '<div role="alert" style="font-family:system-ui,sans-serif;padding:24px">Unable to load note.</div>';
    return;
  }

  const $ = (id) => document.getElementById(id);
  const els = {
    shell: $('shell'),
    chrome: $('chrome'),
    title: $('title'),
    editor: $('editor'),
    preview: $('preview'),
    mdToolbar: $('mdToolbar'),
    btnPreview: $('btnPreview'),
    btnMono: $('btnMono'),
    btnPin: $('btnPin'),
    btnGhost: $('btnGhost'),
    btnCollapse: $('btnCollapse'),
    btnMore: $('btnMore'),
    btnMdMore: $('btnMdMore'),
    morePanel: $('morePanel'),
    palette: $('palette'),
    opacity: $('opacity'),
    opacityValue: $('opacityValue'),
    fontSize: $('fontSize'),
    fontSizeValue: $('fontSizeValue'),
    btnNew: $('btnNew'),
    btnHide: $('btnHide'),
    tagChips: $('tagChips'),
    tagInput: $('tagInput'),
    saveStatus: $('saveStatus'),
    bubble: $('bubble'),
    bubbleInitial: $('bubbleInitial')
  };

  const SAVE_FAILED = 'Not saved yet. Your text is kept here and saving is retried.';
  const DISK_FAILED = 'Not written to disk yet. Ghost Notetaker keeps your text and retries.';
  const md = window.GhostMarkdown;
  let localSaveFailed = false;
  let diskSaveFailed = false;
  let flashMessage = '';
  let flashTimer = null;
  let note = null;
  let colors = [];
  let applying = false;
  // Show formatted Markdown whenever the note is not being edited.
  let formattedWhenIdle = true;
  let editing = params.get('edit') === '1';
  // The view on screen, so a change between views can be animated.
  let shownView = null;

  const BUBBLE = 56;
  const colorOf = (id) => colors.find((x) => x.id === id) || { hex: '#e0eaee', ink: 'dark' };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const morphMs = () => (reducedMotion.matches ? 0 : 240);
  // Panels follow the app theme (System, Light, or Dark) chosen in Settings.
  const applyTheme = (dark) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  };

  /** Switches use aria-checked, toggle buttons aria-pressed. */
  function setPressed(btn, on) {
    btn.setAttribute(btn.getAttribute('role') === 'switch' ? 'aria-checked' : 'aria-pressed', String(on));
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
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
      chip.className = 'tag';
      chip.title = `Remove tag #${tag}`;
      chip.setAttribute('aria-label', `Remove tag ${tag}`);
      const label = document.createElement('span');
      label.textContent = `#${tag}`;
      chip.append(label, icon('x'));
      chip.addEventListener('click', () => {
        queueSave({ tags: (note.tags || []).filter((t) => t !== tag) });
        renderTags();
      });
      els.tagChips.appendChild(chip);
    });
  }

  function applyStyle() {
    const color = colorOf(note.color);
    const opacityPct = Math.round((note.opacity || 1) * 100);
    const fontSize = note.fontSize || 14;
    els.opacity.value = opacityPct;
    els.opacityValue.textContent = `${opacityPct}%`;
    els.fontSize.value = fontSize;
    els.fontSizeValue.textContent = `${fontSize}px`;
    for (const el of [els.shell, els.bubble]) {
      el.style.setProperty('--note-tint', color.hex);
      el.classList.toggle('ink-light', color.ink === 'light');
    }
    els.shell.style.setProperty('--opacity', String(note.opacity || 1));
    els.shell.style.setProperty('--font-size', `${fontSize}px`);
    els.shell.classList.toggle('mono', Boolean(note.monospace));
    setPressed(els.btnMono, Boolean(note.monospace));
    setPressed(els.btnPin, note.pinned !== false);
    setPressed(els.btnGhost, Boolean(note.clickThrough));
    for (const swatch of els.palette.children) {
      swatch.setAttribute('aria-checked', String(swatch.dataset.color === note.color));
    }
    const initial = /[\p{L}\p{N}]/u.exec(note.title || '');
    els.bubbleInitial.textContent = initial ? initial[0].toUpperCase() : '';
    els.bubble.title = note.title || 'Untitled';
    els.bubble.setAttribute('aria-label', `Expand ${note.title || 'Untitled'}`);
  }

  /** Which view the note shows right now. */
  function currentView() {
    if (note.collapsed) return 'bubble';
    if (note.previewMode) return 'reading';
    if (editing || !formattedWhenIdle || !String(note.content || '').trim()) return 'editing';
    return 'formatted';
  }

  function render() {
    const view = currentView();
    // Expanding a bubble waits until the main process has made the window note-sized.
    if (shownView === 'bubble' && view !== 'bubble' && innerWidth < BUBBLE * 2) {
      addEventListener('resize', render, { once: true });
      return;
    }
    const previous = shownView;
    shownView = view;
    document.body.classList.toggle('collapsed', view === 'bubble');
    const showPreview = view === 'reading' || view === 'formatted';
    if (previous && previous !== 'bubble' && view !== 'bubble' && showPreview !== els.editor.classList.contains('hidden')) {
      crossfade(showPreview ? els.editor : els.preview, showPreview ? els.preview : els.editor);
    }
    if (previous === 'bubble' && view !== 'bubble') expandFromBubble();
    else if (!els.bubble.classList.contains('appearing')) els.bubble.hidden = view !== 'bubble';
    els.editor.classList.toggle('hidden', showPreview);
    els.preview.classList.toggle('hidden', !showPreview);
    els.mdToolbar.classList.toggle('hidden', showPreview);
    if (showPreview) setMdOverflow(false);
    els.shell.classList.toggle('reading', view === 'reading');
    setPressed(els.btnPreview, view === 'reading');
    const label = view === 'reading' ? 'Reading mode is on (click text does not edit)' : 'Reading mode';
    els.btnPreview.title = label;
    els.btnPreview.setAttribute('aria-label', label);
    if (showPreview) renderPreview();
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
    render();
    renderTags();
    applying = false;
  }

  function renderPreview() {
    els.preview.innerHTML = md.renderMarkdown(els.editor.value);
  }

  /** Fade the formatted view and the editor into each other. */
  function crossfade(outgoing, incoming) {
    if (reducedMotion.matches) return;
    const ghost = outgoing.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.tabIndex = -1;
    ghost.classList.remove('fade-in');
    ghost.classList.add('fade-out');
    outgoing.after(ghost);
    ghost.scrollTop = outgoing.scrollTop;
    setTimeout(() => ghost.remove(), 200);
    incoming.classList.remove('fade-in');
    void incoming.offsetWidth;
    incoming.classList.add('fade-in');
  }

  /** Scale factors that shrink the paper to the bubble at its top-left corner. */
  function setBubbleScale() {
    const { width, height } = els.shell.getBoundingClientRect();
    els.shell.style.setProperty('--to-bubble-x', String(BUBBLE / width));
    els.shell.style.setProperty('--to-bubble-y', String(BUBBLE / height));
  }

  async function collapseToBubble() {
    setBubbleScale();
    els.shell.classList.add('collapsing');
    els.bubble.hidden = false;
    els.bubble.classList.add('appearing');
    await new Promise((resolve) => setTimeout(resolve, morphMs()));
    const collapsed = await window.ghostNote.setCollapsed(noteId, true).catch(() => null);
    if (collapsed && collapsed.collapsed) applyLocal(collapsed);
    els.shell.classList.remove('collapsing');
    els.bubble.classList.remove('appearing');
    els.bubble.hidden = currentView() !== 'bubble';
  }

  function expandFromBubble() {
    setBubbleScale();
    els.shell.classList.add('expanding');
    els.bubble.classList.add('leaving');
    setTimeout(() => {
      els.shell.classList.remove('expanding');
      els.bubble.classList.remove('leaving');
      els.bubble.hidden = currentView() !== 'bubble';
    }, morphMs());
  }

  /** Source line for a click inside the formatted view. */
  function lineForTarget(target) {
    const item = target.closest('[data-line]');
    if (item && els.preview.contains(item)) return Number(item.getAttribute('data-line'));
    let block = target;
    while (block && block.parentNode !== els.preview) block = block.parentNode;
    for (let node = block; node; node = node.previousSibling) {
      if (node.nodeType === Node.COMMENT_NODE && /^L\d+$/.test(node.data)) return Number(node.data.slice(1));
    }
    return null;
  }

  function startEditing(line) {
    if (note.collapsed) return;
    editing = true;
    render();
    els.editor.focus();
    const value = els.editor.value;
    let pos = value.length;
    if (line != null) {
      const start = md.lineOffset(value, line);
      const end = value.indexOf('\n', start);
      pos = end === -1 ? value.length : end;
    }
    els.editor.setSelectionRange(pos, pos);
  }

  function stopEditing() {
    if (!editing) return;
    editing = false;
    render();
  }

  els.preview.addEventListener('click', (e) => {
    const check = e.target.closest('.task-check');
    if (check) {
      const item = check.closest('[data-task-line]');
      const next = md.toggleTaskAtLine(els.editor.value, Number(item.getAttribute('data-task-line')));
      els.editor.value = next;
      queueSave({ content: next });
      renderPreview();
      return;
    }
    const link = e.target.closest('a');
    if (link) {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href) window.ghostNote.openExternal(href);
      return;
    }
    if (currentView() !== 'formatted') return;
    // In the formatted view only the box itself ticks a task; its text edits.
    if (e.target.closest('.task-item label')) e.preventDefault();
    startEditing(lineForTarget(e.target));
  });

  els.preview.addEventListener('keydown', (e) => {
    if (currentView() === 'formatted' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      startEditing(null);
    }
  });

  // Leaving the window shows the formatted note again.
  window.addEventListener('blur', () => {
    if (formattedWhenIdle) stopEditing();
  });

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
    const message = localSaveFailed ? SAVE_FAILED : diskSaveFailed ? DISK_FAILED : flashMessage;
    els.saveStatus.hidden = !message;
    els.saveStatus.textContent = message;
    els.saveStatus.classList.toggle('info', !localSaveFailed && !diskSaveFailed);
  }

  function flash(message) {
    flashMessage = message;
    renderSaveStatus();
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashMessage = '';
      renderSaveStatus();
    }, 4000);
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
      b.style.backgroundColor = c.hex;
      b.title = c.label;
      b.addEventListener('click', () => {
        queueSave({ color: c.id });
        applyStyle();
      });
      els.palette.appendChild(b);
    });
  }

  function setMdOverflow(open) {
    els.mdToolbar.classList.toggle('overflow-open', open);
    els.btnMdMore.setAttribute('aria-expanded', String(open));
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

  /** Insert text on its own line(s) at the caret. */
  function insertBlock(text) {
    const ta = els.editor;
    const before = ta.value.slice(0, ta.selectionStart);
    const lead = before && !before.endsWith('\n') ? '\n' : '';
    insertAtCursor(`${lead}${text}\n`);
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
    table: () => insertBlock('| Column | Column |\n| --- | --- |\n|  |  |'),
    hr: () => insertAtCursor('\n---\n')
  };

  els.mdToolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-md]');
    if (!btn || !note || currentView() !== 'editing') return;
    setMdOverflow(false);
    const action = MD_ACTIONS[btn.getAttribute('data-md')];
    if (action) action();
  });

  els.btnMdMore.addEventListener('click', () => setMdOverflow(!els.mdToolbar.classList.contains('overflow-open')));
  addEventListener('resize', () => setMdOverflow(false));

  // ---------- images ----------

  const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/;

  async function addImages(files) {
    for (const file of files) {
      try {
        const url = await window.ghostNote.saveImage(noteId, new Uint8Array(await file.arrayBuffer()));
        const alt = (file.name || 'image').replace(/\.[a-z0-9]+$/i, '').replace(/[[\]]/g, '') || 'image';
        insertBlock(`![${alt}](${url})`);
      } catch (err) {
        flash(String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
      }
    }
  }

  const imageFiles = (list) => Array.from(list || []).filter((f) => IMAGE_TYPES.test(f.type));

  els.editor.addEventListener('paste', (e) => {
    const files = imageFiles(e.clipboardData && e.clipboardData.files);
    if (!files.length) return;
    e.preventDefault();
    addImages(files);
  });

  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  document.addEventListener('drop', (e) => {
    const files = imageFiles(e.dataTransfer && e.dataTransfer.files);
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    if (!files.length) {
      flash('Only PNG, JPEG, GIF, and WebP images can be added');
      return;
    }
    if (currentView() !== 'editing') startEditing(null);
    addImages(files);
  });

  // ---------- bubble ----------

  let drag = null;
  els.bubble.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    els.bubble.setPointerCapture(e.pointerId);
    drag = { x: e.screenX, y: e.screenY, moved: false };
  });
  els.bubble.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.screenX - drag.x;
    const dy = e.screenY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    drag.x = e.screenX;
    drag.y = e.screenY;
    window.ghostNote.moveBy(noteId, dx, dy);
  });
  els.bubble.addEventListener('pointerup', () => {
    const wasClick = drag && !drag.moved;
    drag = null;
    if (wasClick) window.ghostNote.setCollapsed(noteId, false);
  });
  els.bubble.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      window.ghostNote.setCollapsed(noteId, false);
    }
  });

  // ---------- chrome ----------

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

  els.title.addEventListener('input', () => {
    queueSave({ title: els.title.value });
    applyStyle();
  });
  els.editor.addEventListener('input', () => queueSave({ content: els.editor.value }));
  els.editor.addEventListener('focus', () => {
    if (!editing) {
      editing = true;
      render();
    }
  });

  els.opacity.addEventListener('input', () => {
    queueSave({ opacity: Number(els.opacity.value) / 100 });
    applyStyle();
  });

  els.fontSize.addEventListener('input', () => {
    queueSave({ fontSize: Number(els.fontSize.value) });
    applyStyle();
  });

  els.btnPreview.addEventListener('click', () => {
    queueSave({ previewMode: !note.previewMode });
    if (!note.previewMode) editing = true;
    render();
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

  els.btnCollapse.addEventListener('click', async () => {
    setMoreOpen(false);
    await flushNow();
    await collapseToBubble();
  });

  els.btnMore.addEventListener('click', (e) => {
    e.stopPropagation();
    setMoreOpen(els.morePanel.classList.contains('hidden'));
  });

  document.addEventListener('click', (e) => {
    if (!els.morePanel.contains(e.target) && !els.btnMore.contains(e.target)) setMoreOpen(false);
    if (!els.mdToolbar.contains(e.target)) setMdOverflow(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (els.mdToolbar.classList.contains('overflow-open')) {
      setMdOverflow(false);
      els.btnMdMore.focus();
    } else if (!els.morePanel.classList.contains('hidden')) {
      setMoreOpen(false);
      els.btnMore.focus();
    } else if (editing && formattedWhenIdle && document.activeElement === els.editor) {
      els.editor.blur();
      editing = false;
      render();
      els.preview.focus();
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
    queueSave({ tags: Array.from(new Set([...(note.tags || []), raw])) });
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

  window.ghostNote.onSettings((s) => {
    formattedWhenIdle = s.formattedWhenIdle !== false;
    if (note) render();
  });

  window.ghostNote.onTheme((theme) => applyTheme(theme.dark));

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
    applyTheme(boot.darkMode);
    if (boot.accentColor) document.documentElement.style.setProperty('--accent', boot.accentColor);
    colors = boot.colors || [];
    formattedWhenIdle = boot.settings.formattedWhenIdle !== false;
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
    if (editing && currentView() === 'editing') startEditing(null);
  }

  init().catch((err) => {
    console.error(err);
    showSafeError('Unable to open note', err && err.message ? err.message : err);
  });
})();
