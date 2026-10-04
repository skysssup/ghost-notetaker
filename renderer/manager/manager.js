'use strict';

(function () {
  if (!window.ghostManager) {
    document.body.textContent = 'Preload bridge missing.';
    return;
  }

  const api = window.ghostManager;
  const state = {
    bootstrap: null,
    notes: [],
    workspaces: [],
    tags: [],
    recent: [],
    activeWorkspaceId: null,
    selectedTag: null,
    query: '',
    visibility: 'all',
    sortBy: 'updated',
    selected: new Set(),
    searchTimer: null,
    recording: null
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    wsList: $('wsList'),
    tagList: $('tagList'),
    recentList: $('recentList'),
    noteList: $('noteList'),
    empty: $('empty'),
    emptyTitle: $('emptyTitle'),
    emptyText: $('emptyText'),
    search: $('search'),
    visibilityFilter: $('visibilityFilter'),
    sortBy: $('sortBy'),
    templateSelect: $('templateSelect'),
    btnNewNote: $('btnNewNote'),
    btnEmptyNew: $('btnEmptyNew'),
    btnNewWs: $('btnNewWs'),
    btnSettings: $('btnSettings'),
    btnShortcuts: $('btnShortcuts'),
    btnExport: $('btnExport'),
    btnImport: $('btnImport'),
    selectAll: $('selectAll'),
    btnBulkShow: $('btnBulkShow'),
    btnBulkHide: $('btnBulkHide'),
    selCount: $('selCount'),
    toast: $('toast'),
    saveBanner: $('saveBanner'),
    modal: $('modal'),
    modalCard: $('modalCard'),
    modalTitle: $('modalTitle'),
    modalBody: $('modalBody'),
    modalFooter: $('modalFooter'),
    modalClose: $('modalClose')
  };

  const COLOR_MAP = {};
  let lastFocus = null;
  let toastTimer = null;

  function colorHex(id) {
    return COLOR_MAP[id] || '#c8d6e5';
  }

  function isMac() {
    return Boolean(state.bootstrap && state.bootstrap.platform === 'darwin');
  }

  function formatRelative(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const sec = Math.round((Date.now() - t) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 48) return `${hr} h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day} days ago`;
    return new Date(iso).toLocaleDateString();
  }

  /** Plain-text preview of a note; skips a leading heading that repeats the title. */
  function snippet(note) {
    let text = String(note.content || '');
    const firstLine = text.split('\n', 1)[0];
    const heading = /^#+\s+(.*)$/.exec(firstLine);
    if (heading && heading[1].trim().toLowerCase() === String(note.title || '').trim().toLowerCase()) {
      text = text.slice(firstLine.length);
    }
    return text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^#+\s+/gm, '')
      .replace(/^\s*[-*]\s+\[[ xX]\]\s*/gm, '')
      .replace(/[*_`[\]()>|~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** ipcRenderer.invoke prefixes main-process errors; show only the message. */
  function errorMessage(err) {
    const raw = err && err.message ? err.message : String(err || 'Unknown error');
    return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'disabled' || key === 'checked') node[key] = Boolean(value);
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }

  function renderSaveBanner(message) {
    els.saveBanner.hidden = !message;
    els.saveBanner.textContent = message
      ? `Changes cannot be written to the notes file (${message}). They are kept in memory and saving is retried every few seconds; export your notes if this continues.`
      : '';
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 5000);
  }

  // ---------- modal ----------

  function getModalFocusable() {
    return Array.from(
      els.modalCard.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((node) => node.offsetParent !== null);
  }

  function closeModal() {
    if (state.recording) stopRecording();
    els.modal.classList.add('hidden');
    els.modalBody.textContent = '';
    els.modalFooter.textContent = '';
    els.modalCard.classList.remove('wide');
    document.removeEventListener('keydown', onModalKeydown, true);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  function onModalKeydown(e) {
    if (els.modal.classList.contains('hidden') || state.recording) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = getModalFocusable();
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /**
   * footerButtons: [{ label, primary?, danger?, onClick(btn) }]. Async handlers
   * disable the footer while running and report failures inside the dialog.
   */
  function openModal({ title, body, footerButtons, wide }) {
    if (els.modal.classList.contains('hidden')) lastFocus = document.activeElement;
    els.modalTitle.textContent = title;
    els.modalBody.replaceChildren(...(Array.isArray(body) ? body : [body]));
    els.modalFooter.textContent = '';
    els.modalCard.classList.toggle('wide', Boolean(wide));
    (footerButtons || []).forEach((b) => {
      const btn = el('button', {
        type: 'button',
        class: b.primary ? 'primary-btn' : b.danger ? 'danger-btn' : 'ghost-btn',
        text: b.label
      });
      btn.addEventListener('click', async () => {
        const buttons = Array.from(els.modalFooter.querySelectorAll('button'));
        buttons.forEach((x) => (x.disabled = true));
        try {
          await b.onClick(btn);
        } catch (err) {
          showModalError(errorMessage(err));
        } finally {
          buttons.forEach((x) => (x.disabled = false));
        }
      });
      els.modalFooter.appendChild(btn);
    });
    els.modal.classList.remove('hidden');
    document.addEventListener('keydown', onModalKeydown, true);
    // Inputs first, then the primary action; confirmations without one (delete,
    // replace) start on Cancel so Enter never triggers the destructive button.
    const focusable =
      els.modalBody.querySelector('input, select, textarea') ||
      els.modalFooter.querySelector('.primary-btn') ||
      els.modalFooter.querySelector('button');
    (focusable || els.modalClose).focus();
  }

  function showModalError(message) {
    let box = els.modalBody.querySelector('.modal-error');
    if (!box) {
      box = el('p', { class: 'modal-error', role: 'alert' });
      els.modalBody.appendChild(box);
    }
    box.textContent = message;
  }

  function showActionError(title, err, retry) {
    const buttons = [{ label: 'Close', onClick: closeModal }];
    if (retry) {
      buttons.push({
        label: 'Try again',
        primary: true,
        onClick: () => {
          closeModal();
          retry();
        }
      });
    }
    openModal({
      title,
      body: el('p', { role: 'alert', text: errorMessage(err) }),
      footerButtons: buttons
    });
  }

  /** Run a list action; failures are shown instead of silently ignored. */
  async function run(title, fn) {
    try {
      return await fn();
    } catch (err) {
      showActionError(title, err);
      return undefined;
    } finally {
      reload().catch(() => {});
    }
  }

  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
  });

  function field(label, input, hint) {
    const id = input.id;
    return el('div', { class: 'field' }, [
      el('label', { for: id, text: label }),
      input,
      ...(hint ? [el('p', { class: 'field-hint', text: hint })] : [])
    ]);
  }

  // ---------- sidebar ----------

  function renderWorkspaces() {
    els.wsList.textContent = '';
    state.workspaces.forEach((ws) => {
      const active = ws.id === state.activeWorkspaceId;
      const row = el('li', { class: 'side-row' }, [
        el('button', {
          type: 'button',
          class: `side-btn${active ? ' active' : ''}`,
          'aria-current': active ? 'true' : 'false',
          text: ws.name,
          onclick: async () => {
            await api.setActiveWorkspace(ws.id);
            state.activeWorkspaceId = ws.id;
            state.selectedTag = null;
            state.selected.clear();
            await reload();
          }
        }),
        el('button', {
          type: 'button',
          class: 'row-btn',
          title: `Rename ${ws.name}`,
          'aria-label': `Rename workspace ${ws.name}`,
          text: '✎',
          onclick: () => promptRenameWorkspace(ws)
        })
      ]);
      if (state.workspaces.length > 1) {
        row.appendChild(
          el('button', {
            type: 'button',
            class: 'row-btn danger',
            title: `Delete ${ws.name}`,
            'aria-label': `Delete workspace ${ws.name}`,
            text: '✕',
            onclick: () => confirmDeleteWorkspace(ws)
          })
        );
      }
      els.wsList.appendChild(row);
    });
  }

  function renderTags() {
    els.tagList.textContent = '';
    const tagButton = (label, tag) =>
      el('li', {}, [
        el('button', {
          type: 'button',
          class: `side-btn${state.selectedTag === tag ? ' active' : ''}`,
          'aria-pressed': String(state.selectedTag === tag),
          text: label,
          onclick: async () => {
            state.selectedTag = tag;
            state.selected.clear();
            await reloadNotesOnly();
            renderTags();
          }
        })
      ]);
    els.tagList.appendChild(tagButton('All notes', null));
    if (!state.tags.length) {
      els.tagList.appendChild(el('li', { class: 'muted-item', text: 'No tags yet' }));
    }
    state.tags.forEach((tag) => els.tagList.appendChild(tagButton(`#${tag}`, tag)));
  }

  function renderRecent() {
    els.recentList.textContent = '';
    if (!state.recent.length) {
      els.recentList.appendChild(el('li', { class: 'muted-item', text: 'No recent notes' }));
      return;
    }
    state.recent.forEach((note) => {
      els.recentList.appendChild(
        el('li', {}, [
          el('button', {
            type: 'button',
            class: 'side-btn recent',
            title: note.title || 'Untitled',
            text: note.title || 'Untitled',
            onclick: () => run('Could not open the note', () => api.openNote(note.id))
          })
        ])
      );
    });
  }

  // ---------- note list ----------

  function updateBulkUi() {
    const n = state.selected.size;
    els.selCount.textContent = n ? `${n} selected` : '';
    els.btnBulkShow.disabled = n === 0;
    els.btnBulkHide.disabled = n === 0;
    els.selectAll.checked = state.notes.length > 0 && n === state.notes.length;
    els.selectAll.indeterminate = n > 0 && n < state.notes.length;
  }

  function renderEmptyState() {
    const filtered = Boolean(state.query || state.selectedTag || state.visibility !== 'all');
    els.emptyTitle.textContent = filtered ? 'No matching notes' : 'No notes in this workspace';
    els.emptyText.textContent = filtered
      ? 'Try a different search, tag, or filter.'
      : 'Create a note or pick a template to get started.';
  }

  function noteCard(note) {
    const title = note.title || 'Untitled';
    const check = el('input', {
      type: 'checkbox',
      class: 'note-check',
      'aria-label': `Select ${title}`,
      checked: state.selected.has(note.id)
    });
    const card = el('article', {
      class: `note-card${state.selected.has(note.id) ? ' selected' : ''}`,
      role: 'listitem',
      'data-note-id': note.id
    });
    check.addEventListener('change', () => {
      if (check.checked) state.selected.add(note.id);
      else state.selected.delete(note.id);
      card.classList.toggle('selected', check.checked);
      updateBulkUi();
    });

    const meta = el('div', { class: 'note-meta' }, [
      el('span', {
        class: `pill ${note.visible ? 'visible' : 'hidden-note'}`,
        text: note.visible ? 'Open' : 'Hidden'
      }),
      el('span', { text: `Edited ${formatRelative(note.updatedAt)}` }),
      ...(note.clickThrough ? [el('span', { class: 'pill warn', text: 'Click-through on' })] : []),
      ...(note.tags || []).map((t) => el('span', { class: 'pill', text: `#${t}` }))
    ]);

    const action = (label, handler, extra = {}) =>
      el('button', { type: 'button', class: 'link-btn', text: label, onclick: handler, ...extra });

    const actions = el('div', { class: 'note-actions' }, [
      action(note.visible ? 'Focus' : 'Open', () =>
        run('Could not open the note', () => api.openNote(note.id))
      ),
      action('Hide', () => run('Could not hide the note', () => api.hideNote(note.id)), {
        disabled: !note.visible
      }),
      ...(note.clickThrough
        ? [
            action('Turn off click-through', () =>
              run('Could not change click-through', () =>
                api.updateNote(note.id, { clickThrough: false })
              )
            )
          ]
        : []),
      action('Rename', () => promptRenameNote(note)),
      action('Tags', () => promptTags(note)),
      action('Duplicate', () => run('Could not duplicate the note', () => api.duplicateNote(note.id))),
      ...(state.workspaces.length > 1 ? [action('Move', () => promptMoveNote(note))] : []),
      action('Export .md', () => exportMarkdown(note)),
      el('span', { class: 'actions-spacer' }),
      action('Delete', () => confirmDeleteNote(note), { class: 'link-btn danger' })
    ]);

    card.append(
      check,
      el('div', { class: 'swatch', style: `background:${colorHex(note.color)}` }),
      el('div', { class: 'note-body' }, [
        el('h3', { class: 'note-title', text: title }),
        el('p', { class: 'note-preview', text: snippet(note) || 'Empty note' }),
        meta,
        actions
      ])
    );
    return card;
  }

  function renderNotes() {
    els.noteList.replaceChildren(...state.notes.map(noteCard));
    els.empty.classList.toggle('hidden', state.notes.length > 0);
    if (!state.notes.length) renderEmptyState();
    updateBulkUi();
  }

  async function exportMarkdown(note) {
    try {
      const filePath = await api.exportMarkdown(note.id);
      if (filePath) showToast(`Exported “${note.title || 'Untitled'}” to ${filePath}`);
    } catch (err) {
      showActionError('Export failed', err, () => exportMarkdown(note));
    }
  }

  // ---------- prompts ----------

  function promptRenameNote(note) {
    const input = el('input', { id: 'mTitle', maxlength: '200' });
    input.value = note.title || '';
    openModal({
      title: 'Rename note',
      body: field('Title', input),
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Save',
          primary: true,
          onClick: async () => {
            await updateNoteOrThrow(note.id, { title: input.value.trim() || 'Untitled' });
            closeModal();
            await reload();
          }
        }
      ]
    });
    input.select();
  }

  function promptTags(note) {
    const input = el('input', { id: 'mTags', placeholder: 'work, follow-up' });
    input.value = (note.tags || []).join(', ');
    openModal({
      title: 'Edit tags',
      body: field('Tags', input, 'Separate tags with commas. Tags are saved in lowercase.'),
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Save',
          primary: true,
          onClick: async () => {
            const tags = input.value
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
            await updateNoteOrThrow(note.id, { tags });
            closeModal();
            await reload();
          }
        }
      ]
    });
  }

  function promptMoveNote(note) {
    const select = el(
      'select',
      { id: 'mMoveWs' },
      state.workspaces.map((ws) => {
        const opt = el('option', { value: ws.id, text: ws.name });
        opt.selected = ws.id === note.workspaceId;
        return opt;
      })
    );
    openModal({
      title: 'Move to workspace',
      body: field('Workspace', select),
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Move',
          primary: true,
          onClick: async () => {
            await updateNoteOrThrow(note.id, { workspaceId: select.value });
            closeModal();
            await reload();
          }
        }
      ]
    });
  }

  async function updateNoteOrThrow(id, patch) {
    const result = await api.updateNote(id, patch);
    if (!result || result.__saveError) throw new Error((result && result.__saveError) || 'This note no longer exists.');
    return result;
  }

  function confirmDeleteNote(note) {
    openModal({
      title: 'Delete note permanently?',
      body: el('p', {}, [
        'Delete ',
        el('strong', { text: note.title || 'Untitled' }),
        ' for good? Hiding a note keeps it; deleting cannot be undone.'
      ]),
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Delete note',
          danger: true,
          onClick: async () => {
            await api.deleteNote(note.id);
            state.selected.delete(note.id);
            closeModal();
            await reload();
          }
        }
      ]
    });
  }

  function promptRenameWorkspace(ws) {
    const input = el('input', { id: 'mWs', maxlength: '80' });
    input.value = ws.name;
    openModal({
      title: 'Rename workspace',
      body: field('Name', input),
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Save',
          primary: true,
          onClick: async () => {
            const name = input.value.trim();
            if (name) await api.renameWorkspace(ws.id, name);
            closeModal();
            await reload();
          }
        }
      ]
    });
    input.select();
  }

  async function confirmDeleteWorkspace(ws) {
    const count = (await api.listNotes({ workspaceId: ws.id })).length;
    openModal({
      title: 'Delete workspace?',
      body: el('p', {}, [
        'Delete ',
        el('strong', { text: ws.name }),
        count
          ? ` and its ${count} note${count === 1 ? '' : 's'}? This cannot be undone. Export first if you might need them.`
          : '? It has no notes.'
      ]),
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: count ? `Delete workspace and ${count} note${count === 1 ? '' : 's'}` : 'Delete workspace',
          danger: true,
          onClick: async () => {
            await api.deleteWorkspace(ws.id);
            closeModal();
            await reload();
          }
        }
      ]
    });
  }

  function promptNewWorkspace() {
    const input = el('input', { id: 'mWsNew', placeholder: 'e.g. Work', maxlength: '80' });
    openModal({
      title: 'New workspace',
      body: field('Name', input),
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Create',
          primary: true,
          onClick: async () => {
            const ws = await api.createWorkspace(input.value.trim() || 'New workspace');
            await api.setActiveWorkspace(ws.id);
            closeModal();
            await reload();
          }
        }
      ]
    });
  }

  // ---------- keyboard shortcuts ----------

  const STATUS_TEXT = {
    active: 'Works everywhere',
    local: 'In notes only',
    unavailable: 'Taken by another app or the OS',
    duplicate: 'Duplicate',
    invalid: 'Invalid',
    off: 'Off'
  };

  function eventToAccelerator(e) {
    const mods = [];
    if (isMac() ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl');
    if (isMac() && e.ctrlKey) mods.push('Control');
    if (!isMac() && e.metaKey) mods.push('Super');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    const code = e.code || '';
    let key = null;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
    else if (code === 'Space') key = 'Space';
    else if (/^Arrow(Up|Down|Left|Right)$/.test(code)) key = code.slice(5);
    return key ? [...mods, key].join('+') : null;
  }

  function stopRecording() {
    document.removeEventListener('keydown', onRecordKeydown, true);
    state.recording = null;
    api.pauseShortcuts(false).catch(() => {});
  }

  async function onRecordKeydown(e) {
    if (!state.recording) return;
    e.preventDefault();
    e.stopPropagation();
    const { id, render } = state.recording;
    if (e.key === 'Escape') {
      stopRecording();
      render();
      return;
    }
    if (['Control', 'Shift', 'Alt', 'Meta', 'OS'].includes(e.key)) return;
    const accel = eventToAccelerator(e);
    stopRecording();
    if (!accel) {
      render('Use a letter, number, F-key, Space, or arrow key.');
      return;
    }
    try {
      render(null, await api.setShortcut(id, accel));
    } catch (err) {
      render(errorMessage(err));
    }
  }

  async function showShortcuts() {
    const table = el('table', { class: 'shortcut-table' });
    const message = el('p', { class: 'field-hint', role: 'status' });

    function render(errorText, list) {
      const draw = (defs) => {
        message.textContent = errorText || '';
        message.classList.toggle('error', Boolean(errorText));
        const rows = defs.map((s) => {
          const recording = state.recording && state.recording.id === s.id;
          const keyCell = recording
            ? el('span', { class: 'kbd recording', text: 'Press the new shortcut… (Esc cancels)' })
            : el('span', { class: 'kbd', text: s.display || '—' });
          const statusClass =
            s.status === 'active' || s.status === 'local' ? 'ok' : s.status === 'off' ? '' : 'bad';
          return el('tr', {}, [
            el('td', { text: s.label }),
            el('td', {}, [keyCell]),
            el('td', { class: `status ${statusClass}`, text: STATUS_TEXT[s.status] || s.status }),
            el('td', { class: 'row-actions' }, [
              el('button', {
                type: 'button',
                class: 'link-btn',
                text: 'Change',
                'aria-label': `Change shortcut for ${s.label}`,
                onclick: async () => {
                  if (state.recording) stopRecording();
                  await api.pauseShortcuts(true);
                  state.recording = { id: s.id, render };
                  document.addEventListener('keydown', onRecordKeydown, true);
                  draw(defs);
                }
              }),
              el('button', {
                type: 'button',
                class: 'link-btn',
                text: 'Clear',
                disabled: !s.accelerator,
                'aria-label': `Clear shortcut for ${s.label}`,
                onclick: async () => {
                  try {
                    render(null, await api.setShortcut(s.id, ''));
                  } catch (err) {
                    render(errorMessage(err));
                  }
                }
              })
            ])
          ]);
        });
        table.replaceChildren(
          el('thead', {}, [
            el('tr', {}, ['Action', 'Shortcut', 'Status', ''].map((h) => el('th', { text: h })))
          ]),
          el('tbody', {}, rows)
        );
      };
      if (list) draw(list);
      else api.listShortcuts().then(draw);
    }

    openModal({
      title: 'Keyboard shortcuts',
      wide: true,
      body: [
        table,
        message,
        el('p', {
          class: 'field-hint',
          text: 'Global shortcuts work while other apps are focused. A shortcut that another app or the OS already uses cannot be registered; pick a different one.'
        })
      ],
      footerButtons: [
        {
          label: 'Reset to defaults',
          onClick: async () => render(null, await api.resetShortcuts())
        },
        { label: 'Done', primary: true, onClick: closeModal }
      ]
    });
    render();
  }

  // ---------- preferences ----------

  async function showSettings() {
    const boot = await api.getBootstrap();
    state.bootstrap = boot;
    const s = boot.settings;
    const caps = boot.capabilities;
    const linuxOnly = 'Not available on Linux.';

    const color = el(
      'select',
      { id: 'sColor' },
      (boot.colors || []).map((c) => {
        const opt = el('option', { value: c.id, text: c.label });
        opt.selected = s.defaultColor === c.id;
        return opt;
      })
    );
    const opacityPct = Math.round((s.defaultOpacity || 0.88) * 100);
    const opacity = el('input', { id: 'sOpacity', type: 'range', min: '25', max: '100', value: String(opacityPct) });
    const opacityOut = el('output', { for: 'sOpacity', text: `${opacityPct}%` });
    opacity.addEventListener('input', () => {
      opacityOut.textContent = `${opacity.value}%`;
    });
    const font = el('input', { id: 'sFont', type: 'number', min: '10', max: '28', value: String(s.defaultFontSize || 14) });
    const sort = el(
      'select',
      { id: 'sSort' },
      [
        ['updated', 'Last edited'],
        ['created', 'Created'],
        ['title', 'Title'],
        ['color', 'Color']
      ].map(([value, label]) => {
        const opt = el('option', { value, text: label });
        opt.selected = s.sortBy === value;
        return opt;
      })
    );
    const check = (id, label, checked, enabled, hint) =>
      el('div', { class: `check-row${enabled ? '' : ' disabled'}` }, [
        el('input', { type: 'checkbox', id, checked: checked && enabled, disabled: !enabled }),
        el('label', { for: id }, [label, ...(hint ? [el('span', { class: 'field-hint', text: hint })] : [])])
      ]);

    const body = [
      el('h3', { class: 'settings-heading', text: 'New notes' }),
      el('div', { class: 'settings-grid' }, [
        field('Color', color),
        el('div', { class: 'field' }, [
          el('label', { for: 'sOpacity', text: 'Opacity' }),
          el('div', { class: 'range-row' }, [opacity, opacityOut])
        ]),
        field('Text size (px)', font),
        field('Sort notes by', sort)
      ]),
      check('sMono', 'Use a monospace font', s.defaultMonospace, true),
      el('h3', { class: 'settings-heading', text: 'Behavior' }),
      check(
        'sProtect',
        'Hide notes and this window from screen capture',
        s.contentProtection !== false,
        caps.contentProtection,
        caps.contentProtection
          ? isMac()
            ? 'Best effort: apps that capture with ScreenCaptureKit can still record these windows.'
            : 'Uses the Windows capture-exclusion flag (Windows 10 2004 or later).'
          : linuxOnly
      ),
      check('sClick', 'Click-through for all notes (ghost mode)', s.globalClickThrough, true),
      check('sLogin', 'Launch at login', s.launchAtLogin, caps.launchAtLogin, caps.launchAtLogin ? '' : linuxOnly),
      el('h3', { class: 'settings-heading', text: 'Data' }),
      el('p', { class: 'data-path' }, [
        'Notes are saved on this computer in ',
        el('code', { text: boot.dataFile }),
        ' '
      ]),
      el('button', {
        type: 'button',
        class: 'link-btn',
        text: 'Show notes file',
        onclick: () => api.revealDataFile()
      }),
      el('p', { class: 'field-hint', text: `Ghost Notetaker ${boot.version}` })
    ];

    openModal({
      title: 'Preferences',
      wide: true,
      body,
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Save',
          primary: true,
          onClick: async () => {
            const patch = {
              defaultOpacity: Number(opacity.value) / 100,
              defaultFontSize: Number(font.value),
              defaultColor: color.value,
              sortBy: sort.value,
              defaultMonospace: $('sMono').checked,
              globalClickThrough: $('sClick').checked
            };
            if (caps.contentProtection) patch.contentProtection = $('sProtect').checked;
            if (caps.launchAtLogin) patch.launchAtLogin = $('sLogin').checked;
            await api.updateSettings(patch);
            state.sortBy = patch.sortBy;
            els.sortBy.value = patch.sortBy;
            closeModal();
            await reload();
            showToast('Preferences saved');
          }
        }
      ]
    });
  }

  // ---------- data ----------

  async function exportAll() {
    try {
      const result = await api.exportAll();
      if (result) {
        showToast(`Exported ${result.notes} note${result.notes === 1 ? '' : 's'} to ${result.filePath}`);
      }
    } catch (err) {
      showActionError('Export failed', err, exportAll);
    }
  }

  async function runImport(mode) {
    try {
      const result = await api.importAll(mode);
      if (result == null) return;
      await reload();
      const lines = [`${result.imported} note${result.imported === 1 ? '' : 's'} imported. Imported notes start hidden; open them from this list.`];
      if (result.warning) lines.push(result.warning);
      openModal({
        title: 'Import complete',
        body: lines.map((t) => el('p', { text: t })),
        footerButtons: [{ label: 'OK', primary: true, onClick: closeModal }]
      });
    } catch (err) {
      showActionError('Import failed', err, () => runImport(mode));
    }
  }

  function promptImport() {
    openModal({
      title: 'Import a backup',
      body: [
        el('p', { text: 'Choose a JSON file made with “Export all notes”.' }),
        el('ul', { class: 'plain-list' }, [
          el('li', {}, [el('strong', { text: 'Merge' }), ' adds the backup to your notes. If a note id already exists, the imported copy gets a new id.']),
          el('li', {}, [el('strong', { text: 'Replace' }), ' swaps all current notes and workspaces for the backup. Your screen-capture setting is kept.'])
        ])
      ],
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Merge…',
          onClick: async () => {
            closeModal();
            await runImport('merge');
          }
        },
        {
          label: 'Replace all…',
          danger: true,
          onClick: async () => {
            closeModal();
            await runImport('replace');
          }
        }
      ]
    });
  }

  // ---------- loading ----------

  async function reloadNotesOnly() {
    const filter = {
      workspaceId: state.activeWorkspaceId,
      tag: state.selectedTag || undefined,
      query: state.query || undefined,
      sortBy: state.sortBy
    };
    if (state.visibility === 'open') filter.visible = true;
    if (state.visibility === 'hidden') filter.visible = false;
    state.notes = await api.listNotes(filter);
    const ids = new Set(state.notes.map((n) => n.id));
    for (const id of [...state.selected]) {
      if (!ids.has(id)) state.selected.delete(id);
    }
    renderNotes();
  }

  async function reload() {
    const boot = await api.getBootstrap();
    state.bootstrap = boot;
    state.workspaces = boot.workspaces;
    state.activeWorkspaceId = boot.activeWorkspaceId;
    if (boot.settings && boot.settings.sortBy) {
      state.sortBy = boot.settings.sortBy;
      els.sortBy.value = state.sortBy;
    }
    state.tags = await api.getTags(state.activeWorkspaceId);
    if (state.selectedTag && !state.tags.includes(state.selectedTag)) state.selectedTag = null;
    state.recent = await api.getRecent(8);
    await reloadNotesOnly();
    renderWorkspaces();
    renderTags();
    renderRecent();
  }

  els.search.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(async () => {
      state.query = els.search.value.trim();
      state.selected.clear();
      await reloadNotesOnly();
    }, 120);
  });

  els.visibilityFilter.addEventListener('change', async () => {
    state.visibility = els.visibilityFilter.value;
    state.selected.clear();
    await reloadNotesOnly();
  });

  els.sortBy.addEventListener('change', async () => {
    state.sortBy = els.sortBy.value;
    await api.updateSettings({ sortBy: state.sortBy });
    await reloadNotesOnly();
  });

  els.selectAll.addEventListener('change', () => {
    state.selected.clear();
    if (els.selectAll.checked) state.notes.forEach((n) => state.selected.add(n.id));
    renderNotes();
  });

  async function bulkVisible(visible) {
    const ids = [...state.selected];
    state.selected.clear();
    await run(visible ? 'Could not show the notes' : 'Could not hide every note', () =>
      api.bulkVisible(ids, visible)
    );
  }

  els.btnBulkShow.addEventListener('click', () => bulkVisible(true));
  els.btnBulkHide.addEventListener('click', () => bulkVisible(false));

  function createFromToolbar() {
    return run('Could not create a note', () =>
      api.createNote({
        templateId: els.templateSelect.value || 'blank',
        workspaceId: state.activeWorkspaceId
      })
    );
  }

  els.btnNewNote.addEventListener('click', createFromToolbar);
  els.btnEmptyNew.addEventListener('click', createFromToolbar);
  els.btnNewWs.addEventListener('click', promptNewWorkspace);
  els.btnSettings.addEventListener('click', showSettings);
  els.btnShortcuts.addEventListener('click', showShortcuts);
  els.btnExport.addEventListener('click', exportAll);
  els.btnImport.addEventListener('click', promptImport);

  api.onSaveState((saveState) => renderSaveBanner(saveState.ok ? null : saveState.message));
  api.onRefresh(() => reload().catch((err) => console.error(err)));
  api.onShowShortcuts(() => showShortcuts());
  api.onShowSettings(() => showSettings());

  window.addEventListener('beforeunload', () => {
    if (state.recording) api.pauseShortcuts(false);
  });

  function showSafeError(title, detail) {
    const box = el('div', { role: 'alert', class: 'load-error' }, [
      el('h1', { text: title }),
      el('p', { text: String(detail || 'Something went wrong.').slice(0, 500) }),
      el('p', { class: 'field-hint', text: 'The notes file was not modified by this window. Restart the app after fixing the issue.' })
    ]);
    document.body.replaceChildren(box);
  }

  async function init() {
    state.bootstrap = await api.getBootstrap();
    renderSaveBanner(state.bootstrap.saveError);
    (state.bootstrap.colors || []).forEach((c) => {
      COLOR_MAP[c.id] = c.hex;
    });
    els.templateSelect.replaceChildren(
      ...(state.bootstrap.templates || []).map((t) => el('option', { value: t.id, text: t.label }))
    );
    await reload();
  }

  init().catch((err) => {
    console.error(err);
    showSafeError('Unable to open Notes Manager', errorMessage(err));
  });
})();
