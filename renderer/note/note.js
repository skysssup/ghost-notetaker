'use strict';

(function () {
  const params = new URLSearchParams(location.search);
  const noteId = params.get('id');
  if (!noteId || !window.ghostNote) {
    document.body.textContent = 'Unable to load note.';
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
    btnColor: document.getElementById('btnColor'),
    palette: document.getElementById('palette'),
    opacity: document.getElementById('opacity'),
    fontSize: document.getElementById('fontSize'),
    btnNew: document.getElementById('btnNew'),
    btnHide: document.getElementById('btnHide'),
    tagChips: document.getElementById('tagChips'),
    tagInput: document.getElementById('tagInput'),
    modeLabel: document.getElementById('modeLabel')
  };

  let note = null;
  let colors = [];
  let applying = false;

  function colorHex(id) {
    const c = colors.find((x) => x.id === id);
    return (c && c.hex) || '#c8d6e5';
  }

  function renderTags() {
    els.tagChips.innerHTML = '';
    (note.tags || []).forEach((tag) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip';
      chip.title = 'Remove tag';
      chip.innerHTML = `<span>#${escapeHtml(tag)}</span><span class="tag-x">×</span>`;
      chip.addEventListener('click', () => {
        const tags = (note.tags || []).filter((t) => t !== tag);
        note.tags = tags;
        queueSave({ tags });
        renderTags();
      });
      els.tagChips.appendChild(chip);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function applyLocal(n) {
    applying = true;
    note = n;
    els.title.value = n.title || '';
    els.editor.value = n.content || '';
    els.opacity.value = Math.round((n.opacity || 0.88) * 100);
    els.fontSize.value = n.fontSize || 14;
    els.shell.style.setProperty('--note-tint', colorHex(n.color));
    els.shell.style.setProperty('--opacity', String(n.opacity || 0.88));
    els.shell.style.setProperty('--font-size', `${n.fontSize || 14}px`);
    els.btnColor.style.background = colorHex(n.color);
    els.shell.classList.toggle('mono', Boolean(n.monospace));
    els.btnMono.classList.toggle('active', Boolean(n.monospace));
    els.btnPin.classList.toggle('active', n.pinned !== false);
    els.btnGhost.classList.toggle('active', Boolean(n.clickThrough));
    els.btnPreview.classList.toggle('active', Boolean(n.previewMode));
    els.btnPreview.textContent = n.previewMode ? '✎' : '◈';
    setPreviewMode(Boolean(n.previewMode));
    renderTags();
    applying = false;
  }

  function setPreviewMode(on) {
    els.editor.classList.toggle('hidden', on);
    els.preview.classList.toggle('hidden', !on);
    els.mdToolbar.classList.toggle('hidden', on);
    els.modeLabel.textContent = on ? 'preview' : 'edit';
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
      });
    });
  }

  const saveQueue = (window.GhostSaveQueue || require('./save-queue')).createSaveQueue({
    delayMs: 160,
    flush: (patch) => window.ghostNote.updateNote(noteId, patch)
  });

  function queueSave(patch) {
    if (applying) return;
    Object.assign(note, patch);
    saveQueue.queue(patch);
  }

  function buildPalette() {
    els.palette.innerHTML = '';
    colors.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = c.hex;
      b.title = c.label;
      b.classList.toggle('selected', note && note.color === c.id);
      b.addEventListener('click', () => {
        queueSave({ color: c.id });
        els.shell.style.setProperty('--note-tint', c.hex);
        els.btnColor.style.background = c.hex;
        els.palette.classList.add('hidden');
        buildPalette();
      });
      els.palette.appendChild(b);
    });
  }

  function wrapSelection(before, after, placeholder) {
    const ta = els.editor;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const selected = value.slice(start, end) || placeholder || '';
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    ta.value = next;
    const cursor = start + before.length + selected.length;
    ta.focus();
    ta.setSelectionRange(start + before.length, cursor);
    queueSave({ content: next });
  }

  function prefixLines(prefix) {
    const ta = els.editor;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const sliceEnd = lineEnd === -1 ? value.length : lineEnd;
    const block = value.slice(lineStart, sliceEnd);
    const nextBlock = block
      .split('\n')
      .map((line) => (line.startsWith(prefix) ? line : prefix + line))
      .join('\n');
    const next = value.slice(0, lineStart) + nextBlock + value.slice(sliceEnd);
    ta.value = next;
    ta.focus();
    ta.setSelectionRange(lineStart, lineStart + nextBlock.length);
    queueSave({ content: next });
  }

  function insertAtCursor(text) {
    const ta = els.editor;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const next = value.slice(0, start) + text + value.slice(end);
    ta.value = next;
    const pos = start + text.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    queueSave({ content: next });
  }

  els.mdToolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-md]');
    if (!btn || note.previewMode) return;
    const kind = btn.getAttribute('data-md');
    switch (kind) {
      case 'h2':
        prefixLines('## ');
        break;
      case 'bold':
        wrapSelection('**', '**', 'bold');
        break;
      case 'italic':
        wrapSelection('*', '*', 'italic');
        break;
      case 'code':
        wrapSelection('`', '`', 'code');
        break;
      case 'link':
        wrapSelection('[', '](https://)', 'label');
        break;
      case 'ul':
        prefixLines('- ');
        break;
      case 'ol':
        prefixLines('1. ');
        break;
      case 'task':
        prefixLines('- [ ] ');
        break;
      case 'quote':
        prefixLines('> ');
        break;
      case 'hr':
        insertAtCursor('\n---\n');
        break;
      default:
        break;
    }
  });

  let chromeHover = false;
  function setChromeHover(on) {
    if (chromeHover === on) return;
    chromeHover = on;
    window.ghostNote.chromeHover(noteId, on);
  }

  els.chrome.addEventListener('mouseenter', () => setChromeHover(true));
  els.chrome.addEventListener('mouseleave', () => setChromeHover(false));
  els.mdToolbar.addEventListener('mouseenter', () => setChromeHover(true));
  els.mdToolbar.addEventListener('mouseleave', () => setChromeHover(false));

  els.title.addEventListener('input', () => queueSave({ title: els.title.value }));
  els.editor.addEventListener('input', () => queueSave({ content: els.editor.value }));

  els.opacity.addEventListener('input', () => {
    const opacity = Number(els.opacity.value) / 100;
    els.shell.style.setProperty('--opacity', String(opacity));
    queueSave({ opacity });
  });

  els.fontSize.addEventListener('input', () => {
    const fontSize = Number(els.fontSize.value);
    els.shell.style.setProperty('--font-size', `${fontSize}px`);
    queueSave({ fontSize });
  });

  els.btnPreview.addEventListener('click', () => {
    const previewMode = !note.previewMode;
    queueSave({ previewMode });
    setPreviewMode(previewMode);
    els.btnPreview.classList.toggle('active', previewMode);
    els.btnPreview.textContent = previewMode ? '✎' : '◈';
  });

  els.btnMono.addEventListener('click', () => {
    const monospace = !note.monospace;
    queueSave({ monospace });
    els.shell.classList.toggle('mono', monospace);
    els.btnMono.classList.toggle('active', monospace);
  });

  els.btnPin.addEventListener('click', () => {
    const pinned = !note.pinned;
    queueSave({ pinned });
    els.btnPin.classList.toggle('active', pinned);
  });

  els.btnGhost.addEventListener('click', async () => {
    const clickThrough = !note.clickThrough;
    await window.ghostNote.setClickThrough(noteId, clickThrough);
    note.clickThrough = clickThrough;
    els.btnGhost.classList.toggle('active', clickThrough);
  });

  els.btnColor.addEventListener('click', (e) => {
    e.stopPropagation();
    els.palette.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!els.palette.contains(e.target) && e.target !== els.btnColor) {
      els.palette.classList.add('hidden');
    }
  });

  els.btnNew.addEventListener('click', () => {
    window.ghostNote.createNote({ templateId: 'blank' });
  });

  els.btnHide.addEventListener('click', () => {
    window.ghostNote.hideNote(noteId);
  });

  function addTagFromInput() {
    const raw = els.tagInput.value.trim().replace(/^#/, '');
    if (!raw) return;
    const tags = Array.from(new Set([...(note.tags || []), raw]));
    note.tags = tags;
    els.tagInput.value = '';
    queueSave({ tags });
    renderTags();
  }

  els.tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTagFromInput();
    } else if (e.key === 'Backspace' && !els.tagInput.value && (note.tags || []).length) {
      const tags = note.tags.slice(0, -1);
      note.tags = tags;
      queueSave({ tags });
      renderTags();
    }
  });
  els.tagInput.addEventListener('blur', () => {
    if (els.tagInput.value.trim()) addTagFromInput();
  });

  // Keyboard shortcuts for markdown while editing
  els.editor.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'b') {
      e.preventDefault();
      wrapSelection('**', '**', 'bold');
    } else if (e.key === 'i') {
      e.preventDefault();
      wrapSelection('*', '*', 'italic');
    } else if (e.key === 'k') {
      e.preventDefault();
      wrapSelection('[', '](https://)', 'label');
    }
  });

  window.ghostNote.onUpdated((n) => {
    if (n && n.id === noteId) applyLocal(n);
  });

  async function init() {
    const boot = await window.ghostNote.getBootstrap();
    colors = boot.colors || [];
    const n = await window.ghostNote.getNote(noteId);
    if (!n) {
      document.body.textContent = 'Note not found.';
      return;
    }
    applyLocal(n);
    buildPalette();
  }

  init().catch((err) => {
    console.error(err);
    document.body.textContent = String(err);
  });
})();
