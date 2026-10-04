'use strict';

(function () {
  if (!window.ghostManager) {
    document.body.textContent = 'Preload bridge missing.';
    return;
  }

  const api = window.ghostManager;
  const md = window.GhostMarkdown;
  // The main process resolves System/Light/Dark; the query avoids a flash before the first answer.
  document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
  const TRASH_DAYS = 30;
  const state = {
    bootstrap: null,
    notes: [],
    allNotes: [],
    trash: [],
    workspaces: [],
    tags: [],
    recent: [],
    backups: [],
    activeWorkspaceId: null,
    selectedTag: null,
    query: '',
    visibility: 'all',
    sortBy: 'updated',
    layout: 'list',
    view: 'notes',
    selected: new Set(),
    focusId: null,
    renamingId: null,
    pendingRender: false,
    searchTimer: null,
    recording: null,
    menuAnchor: null,
    renderedSignature: ''
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    wsList: $('wsList'),
    tagList: $('tagList'),
    recentList: $('recentList'),
    noteList: $('noteList'),
    notesScroller: $('notesScroller'),
    empty: $('empty'),
    emptyTitle: $('emptyTitle'),
    search: $('search'),
    searchHint: $('searchHint'),
    sortBy: $('sortBy'),
    sortLabel: $('sortLabel'),
    btnBoard: $('btnBoard'),
    btnList: $('btnList'),
    btnNewNote: $('btnNewNote'),
    btnTemplates: $('btnTemplates'),
    btnEmptyNew: $('btnEmptyNew'),
    btnNewWs: $('btnNewWs'),
    btnTrash: $('btnTrash'),
    trashCount: $('trashCount'),
    btnSettings: $('btnSettings'),
    btnShortcuts: $('btnShortcuts'),
    viewTitle: $('viewTitle'),
    viewSub: $('viewSub'),
    countAll: $('countAll'),
    countOpen: $('countOpen'),
    countHidden: $('countHidden'),
    bulkBar: $('bulkBar'),
    selectAll: $('selectAll'),
    btnBulkShow: $('btnBulkShow'),
    btnBulkHide: $('btnBulkHide'),
    btnBulkTrash: $('btnBulkTrash'),
    selCount: $('selCount'),
    notesView: $('notesView'),
    trashView: $('trashView'),
    trashList: $('trashList'),
    trashEmpty: $('trashEmpty'),
    btnEmptyTrash: $('btnEmptyTrash'),
    settingsView: $('settingsView'),
    settingsBody: $('settingsBody'),
    settingsScroller: $('settingsScroller'),
    settingsSaved: $('settingsSaved'),
    menu: $('menu'),
    toast: $('toast'),
    toastText: $('toastText'),
    toastAction: $('toastAction'),
    saveBanner: $('saveBanner'),
    modal: $('modal'),
    modalCard: $('modalCard'),
    modalTitle: $('modalTitle'),
    modalBody: $('modalBody'),
    modalFooter: $('modalFooter'),
    modalClose: $('modalClose'),
    brandSub: $('brandSub')
  };

  let lastFocus = null;
  let toastTimer = null;
  let toastAction = null;
  let savedTimer = null;
  let reloadSeq = 0;
  let listSeq = 0;

  // ---------- helpers ----------

  function isMac() {
    return Boolean(state.bootstrap && state.bootstrap.platform === 'darwin');
  }

  const modLabel = () => (isMac() ? '⌘' : 'Ctrl+');
  /** Key names as the platform writes them in menus. */
  const keyHint = (key) => (isMac() ? { Delete: '⌘⌫', Enter: '↩' } : { Delete: 'Del' })[key] || key;

  const SORTS = [
    { value: 'updated', label: 'Last edited' },
    { value: 'created', label: 'Created' },
    { value: 'title', label: 'Title' },
    { value: 'color', label: 'Color' }
  ];

  function colorOf(id) {
    const colors = (state.bootstrap && state.bootstrap.colors) || [];
    return colors.find((c) => c.id === id) || { id, hex: '#c8d6e5', ink: 'dark', label: id };
  }

  function formatRelative(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const sec = Math.round((Date.now() - t) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} h ago`;
    const day = Math.round(hr / 24);
    if (day === 1) return 'yesterday';
    if (day < 30) return `${day} days ago`;
    return new Date(iso).toLocaleDateString();
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  /** Note text without a first heading that only repeats the title. */
  function bodyText(note) {
    const text = String(note.content || '');
    const firstLine = text.split('\n', 1)[0];
    const heading = /^#+\s+(.*)$/.exec(firstLine);
    if (heading && heading[1].trim().toLowerCase() === String(note.title || '').trim().toLowerCase()) {
      return text.slice(firstLine.length).replace(/^\s*\n/, '');
    }
    return text;
  }

  /** Plain-text preview of a note. */
  function snippet(note) {
    return bodyText(note)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/^#+\s+/gm, '')
      .replace(/^\s*[-*]\s+\[[ xX]\]\s*/gm, '')
      .replace(/[*_`[\]()>|~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  }

  /** ipcRenderer.invoke prefixes main-process errors; show only the message. */
  function errorMessage(err) {
    const raw = err && err.message ? err.message : String(err || 'Unknown error');
    return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'disabled' || key === 'checked') node[key] = Boolean(value);
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
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

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const noteById = (id) => state.notes.find((n) => n.id === id) || state.allNotes.find((n) => n.id === id);

  function renderSaveBanner(message) {
    els.saveBanner.hidden = !message;
    els.saveBanner.textContent = message
      ? `Changes cannot be written to the notes file (${message}). They are kept in memory and saving is retried every few seconds; export your notes if this continues.`
      : '';
  }

  // ---------- toast ----------

  function hideToast() {
    els.toast.classList.add('hidden');
    toastAction = null;
  }

  /** A short message at the bottom; `action` adds a button such as Undo. */
  function showToast(message, action) {
    els.toastText.textContent = message;
    toastAction = action || null;
    els.toastAction.hidden = !action;
    if (action) els.toastAction.textContent = action.label;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 8000 : 5000);
  }

  els.toastAction.addEventListener('click', async () => {
    const action = toastAction;
    hideToast();
    if (action) await action.onClick();
  });

  // ---------- modal ----------

  function getModalFocusable() {
    return Array.from(
      els.modalCard.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((node) => node.offsetParent !== null);
  }

  function closeModal() {
    els.modal.classList.add('hidden');
    els.modalBody.textContent = '';
    els.modalFooter.textContent = '';
    els.modalCard.classList.remove('wide');
    document.removeEventListener('keydown', onModalKeydown, true);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  function onModalKeydown(e) {
    if (els.modal.classList.contains('hidden')) return;
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
    closeMenu();
    if (els.modal.classList.contains('hidden')) lastFocus = document.activeElement;
    els.modalTitle.textContent = title;
    els.modalBody.replaceChildren(...(Array.isArray(body) ? body : [body]));
    els.modalFooter.textContent = '';
    els.modalCard.classList.toggle('wide', Boolean(wide));
    (footerButtons || []).forEach((b) => {
      const btn = el('button', {
        type: 'button',
        class: b.primary ? 'primary-btn' : b.danger ? 'danger-btn' : 'hairline-btn',
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

  /** Run an action; failures are shown instead of silently ignored. */
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
    return el('div', { class: 'field' }, [
      el('label', { for: input.id, text: label }),
      input,
      ...(hint ? [el('p', { class: 'field-hint', text: hint })] : [])
    ]);
  }

  // ---------- menu ----------

  function menuItems() {
    return Array.from(els.menu.querySelectorAll('.menu-item:not([disabled]), .swatch-btn'));
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (els.menu.classList.contains('hidden')) return;
    els.menu.classList.add('hidden');
    els.menu.textContent = '';
    const anchor = state.menuAnchor;
    state.menuAnchor = null;
    if (anchor) {
      anchor.setAttribute('aria-expanded', 'false');
      if (restoreFocus && document.contains(anchor)) anchor.focus();
    }
    if (state.pendingRender) renderNotes();
  }

  /**
   * items: { label, icon?, checked?, hint?, danger?, attrs?, onSelect } | 'sep' |
   * { swatches, current, label, onPick }. Items with `checked` are radio items
   * with a check mark on the current one. Opens under `anchor` or at `point`.
   */
  function openMenu(items, { anchor = null, point = null, label = 'Actions' } = {}) {
    closeMenu();
    const nodes = items.map((item) => {
      if (item === 'sep') return el('div', { class: 'menu-sep', role: 'separator' });
      if (item.swatches) {
        return el(
          'div',
          { class: 'menu-colors', role: 'group', 'aria-label': item.label },
          [
            el('span', { class: 'section-label', text: item.label }),
            el(
              'div',
              { class: 'swatches' },
              item.swatches.map((c) =>
                el('button', {
                  type: 'button',
                  class: 'swatch-btn',
                  role: 'menuitemradio',
                  'aria-checked': String(c.id === item.current),
                  'aria-label': c.label,
                  title: c.label,
                  'data-color': c.id,
                  style: `background-color:${c.hex}`,
                  onclick: () => {
                    closeMenu({ restoreFocus: true });
                    item.onPick(c.id);
                  }
                })
              )
            )
          ]
        );
      }
      const radio = item.checked !== undefined;
      return el(
        'button',
        {
          type: 'button',
          class: `menu-item${item.danger ? ' danger' : ''}`,
          role: radio ? 'menuitemradio' : 'menuitem',
          'aria-checked': radio ? String(item.checked) : undefined,
          disabled: item.disabled,
          ...(item.attrs || {}),
          onclick: () => {
            closeMenu({ restoreFocus: true });
            item.onSelect();
          }
        },
        [
          ...(radio ? [item.checked ? icon('check') : el('span', { class: 'check-slot' })] : []),
          ...(item.icon ? [icon(item.icon)] : []),
          el('span', { text: item.label }),
          ...(item.hint ? [el('span', { class: 'hint', text: item.hint })] : [])
        ]
      );
    });
    els.menu.replaceChildren(...nodes);
    els.menu.setAttribute('aria-label', label);
    els.menu.classList.remove('hidden');
    const rect = anchor
      ? anchor.getBoundingClientRect()
      : { left: point.x, right: point.x, top: point.y, bottom: point.y };
    const w = els.menu.offsetWidth;
    const h = els.menu.offsetHeight;
    let left = anchor ? (anchor.dataset.menuAlign === 'start' ? rect.left : rect.right - w) : rect.left;
    let top = rect.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 4);
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    els.menu.style.left = `${left}px`;
    els.menu.style.top = `${top}px`;
    state.menuAnchor = anchor;
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    const first = menuItems()[0];
    if (first) first.focus();
  }

  els.menu.addEventListener('keydown', (e) => {
    const items = menuItems();
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu({ restoreFocus: true });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      items[(i + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      closeMenu({ restoreFocus: true });
    }
  });

  document.addEventListener(
    'mousedown',
    (e) => {
      if (!els.menu.classList.contains('hidden') && !els.menu.contains(e.target)) {
        const onAnchor = state.menuAnchor && state.menuAnchor.contains(e.target);
        closeMenu();
        // A click on the anchor that opened the menu just closes it.
        if (onAnchor) e.target.closest('button').dataset.justClosed = '1';
      }
    },
    true
  );
  window.addEventListener('blur', () => closeMenu());
  window.addEventListener('resize', () => closeMenu());

  function anchorJustClosed(btn) {
    if (btn.dataset.justClosed) {
      delete btn.dataset.justClosed;
      return true;
    }
    return false;
  }

  // ---------- views ----------

  function showView(view, { section } = {}) {
    if (state.recording) stopRecording();
    closeMenu();
    state.view = view;
    els.notesView.hidden = view !== 'notes';
    els.trashView.hidden = view !== 'trash';
    els.settingsView.hidden = view !== 'settings';
    els.btnTrash.classList.toggle('active', view === 'trash');
    els.btnTrash.setAttribute('aria-current', view === 'trash' ? 'page' : 'false');
    const inSettings = view === 'settings';
    els.btnSettings.classList.toggle('active', inSettings && section !== 'setShortcuts');
    els.btnShortcuts.classList.toggle('active', inSettings && section === 'setShortcuts');
    renderWorkspaces();
    if (view === 'trash') renderTrash();
    if (inSettings) {
      renderSettings();
      const target = section ? $(section) : null;
      els.settingsScroller.style.scrollBehavior = 'auto';
      els.settingsScroller.scrollTop = target ? target.offsetTop - 12 : 0;
      els.settingsScroller.style.scrollBehavior = '';
      updateSettingsNav();
    }
  }

  // ---------- sidebar ----------

  function renderWorkspaces() {
    els.wsList.textContent = '';
    const counts = new Map();
    for (const n of state.allNotes) counts.set(n.workspaceId, (counts.get(n.workspaceId) || 0) + 1);
    state.workspaces.forEach((ws) => {
      const active = state.view === 'notes' && ws.id === state.activeWorkspaceId;
      const actions = [
        el(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            title: `Rename ${ws.name}`,
            'aria-label': `Rename workspace ${ws.name}`,
            onclick: () => promptRenameWorkspace(ws)
          },
          [icon('pencil')]
        )
      ];
      if (state.workspaces.length > 1) {
        actions.push(
          el(
            'button',
            {
              type: 'button',
              class: 'icon-btn danger',
              title: `Delete ${ws.name}`,
              'aria-label': `Delete workspace ${ws.name}`,
              onclick: () => confirmDeleteWorkspace(ws)
            },
            [icon('trash-2')]
          )
        );
      }
      els.wsList.appendChild(
        el('li', { class: 'side-row' }, [
          el(
            'button',
            {
              type: 'button',
              class: `side-btn${active ? ' active' : ''}`,
              'aria-current': active ? 'true' : 'false',
              onclick: () => selectWorkspace(ws.id)
            },
            [icon('folder'), el('span', { class: 'label', text: ws.name }), el('span', { class: 'count', text: String(counts.get(ws.id) || 0) })]
          ),
          el('span', { class: 'row-actions' }, actions)
        ])
      );
    });
  }

  async function selectWorkspace(id) {
    try {
      if (id !== state.activeWorkspaceId) {
        await api.setActiveWorkspace(id);
        state.activeWorkspaceId = id;
        state.selectedTag = null;
        state.selected.clear();
        state.focusId = null;
      }
      showView('notes');
      await reload();
    } catch (err) {
      showActionError('Could not switch workspace', err);
    }
  }

  function renderTags() {
    els.tagList.textContent = '';
    if (!state.tags.length) {
      els.tagList.appendChild(el('li', { class: 'muted-item', text: 'No tags yet' }));
      return;
    }
    state.tags.forEach((tag) => {
      const active = state.selectedTag === tag;
      els.tagList.appendChild(
        el('li', {}, [
          el('button', {
            type: 'button',
            class: `side-btn tag-row${active ? ' active' : ''}`,
            'aria-pressed': String(active),
            text: `#${tag}`,
            onclick: () => setTag(active ? null : tag)
          })
        ])
      );
    });
  }

  async function setTag(tag) {
    state.selectedTag = tag;
    state.selected.clear();
    showView('notes');
    renderTags();
    await reloadNotesOnly();
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
          el(
            'button',
            {
              type: 'button',
              class: 'side-btn recent',
              title: `Open ${note.title || 'Untitled'}`,
              onclick: () => run('Could not open the note', () => api.openNote(note.id))
            },
            [
              el('span', { class: 'recent-square', style: `background-color:${colorOf(note.color).hex}` }),
              el('span', { class: 'label', text: note.title || 'Untitled' })
            ]
          )
        ])
      );
    });
  }

  function renderTrashCount() {
    els.trashCount.textContent = state.trash.length ? String(state.trash.length) : '';
  }

  // ---------- notes view ----------

  function matchesFilters(n) {
    if (n.workspaceId !== state.activeWorkspaceId) return false;
    if (state.selectedTag && !n.tags.some((t) => t.toLowerCase() === state.selectedTag)) return false;
    if (state.query) {
      const q = state.query.toLowerCase();
      return (
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  }

  function renderHeader() {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    els.viewTitle.textContent = ws ? ws.name : 'Notes';
    const inWs = state.allNotes.filter((n) => n.workspaceId === state.activeWorkspaceId);
    const onScreen = inWs.filter((n) => n.visible).length;
    els.viewSub.replaceChildren(inWs.length ? `${plural(inWs.length, 'note')} · ${onScreen} on screen` : 'No notes yet');
    if (state.selectedTag) {
      els.viewSub.append(
        ` · showing #${state.selectedTag} `,
        el('button', { type: 'button', class: 'link-btn', text: 'Show all', onclick: () => setTag(null) })
      );
    }
    const matching = state.allNotes.filter(matchesFilters);
    const open = matching.filter((n) => n.visible).length;
    els.countAll.textContent = String(matching.length);
    els.countOpen.textContent = String(open);
    els.countHidden.textContent = String(matching.length - open);
    for (const btn of document.querySelectorAll('[data-visibility]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.visibility === state.visibility));
    }
  }

  /** The strip above the notes: column labels in the list, the bulk actions while notes are selected. */
  function updateBulkUi() {
    const n = state.selected.size;
    els.selCount.textContent = n ? `${n} selected` : '';
    els.bulkBar.classList.toggle('has-selection', n > 0);
    els.bulkBar.classList.toggle('columns', state.layout === 'list');
    els.noteList.classList.toggle('selecting', n > 0);
    for (const b of [els.btnBulkShow, els.btnBulkHide, els.btnBulkTrash]) b.disabled = n === 0;
    els.selectAll.checked = state.notes.length > 0 && n === state.notes.length;
    els.selectAll.indeterminate = n > 0 && n < state.notes.length;
    els.bulkBar.hidden = state.notes.length === 0;
  }

  function renderEmptyState() {
    const filtered = Boolean(state.query || state.selectedTag || state.visibility !== 'all');
    els.emptyTitle.textContent = filtered ? 'No matching notes' : 'No notes in this workspace';
  }

  function toggleSelected(id, on) {
    if (on) state.selected.add(id);
    else state.selected.delete(id);
    const card = cardEl(id);
    if (card) {
      card.classList.toggle('selected', on);
      const check = card.querySelector('.note-check');
      if (check) check.checked = on;
    }
    updateBulkUi();
  }

  const cardEls = () => Array.from(els.noteList.querySelectorAll('.note-card'));
  const cardEl = (id) => els.noteList.querySelector(`.note-card[data-note-id="${CSS.escape(id)}"]`);

  function focusCard(id) {
    const cards = cardEls();
    if (!cards.length) return;
    const target = cardEl(id) || cards[0];
    state.focusId = target.dataset.noteId;
    for (const c of cards) c.tabIndex = c === target ? 0 : -1;
    target.focus();
  }

  /** Long notes and notes with images get the tall card on the board. */
  function isTall(note) {
    const text = bodyText(note);
    return /!\[[^\]]*\]\(/.test(text) || text.split('\n').filter((line) => line.trim()).length > 3;
  }

  function noteCard(note) {
    const title = note.title || 'Untitled';
    const color = colorOf(note.color);
    const selected = state.selected.has(note.id);
    const card = el('article', {
      class: `note-card${note.visible ? ' visible-note' : ''}${color.ink === 'light' ? ' ink-light' : ''}${selected ? ' selected' : ''}${isTall(note) ? ' tall' : ''}`,
      role: 'listitem',
      tabindex: '-1',
      'data-note-id': note.id,
      'aria-label': `${title}, ${note.visible ? 'on screen' : 'hidden'}`
    });
    card.style.setProperty('--tint', color.hex);

    const check = el('input', {
      type: 'checkbox',
      class: 'note-check',
      tabindex: '-1',
      'aria-label': `Select ${title}`,
      checked: selected
    });
    check.addEventListener('change', () => toggleSelected(note.id, check.checked));

    const titleEl = el('h3', { class: 'note-title', text: title, title: 'Double-click to rename' });
    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(note.id);
    });

    const more = el(
      'button',
      {
        type: 'button',
        class: 'icon-btn card-more',
        title: 'More actions',
        'aria-label': `More actions for ${title}`,
        'aria-haspopup': 'menu',
        'aria-expanded': 'false'
      },
      [icon('ellipsis')]
    );
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      if (anchorJustClosed(more)) return;
      openNoteMenu(note, { anchor: more });
    });

    const body = el('div', { class: 'card-body', 'aria-hidden': 'true' });
    const text = bodyText(note);
    if (text.trim()) body.innerHTML = md.renderMarkdown(text.slice(0, 1500));
    else body.appendChild(el('p', { class: 'card-empty', text: 'Empty note' }));

    const openBtn = el(
      'button',
      {
        type: 'button',
        class: 'icon-btn open-btn',
        title: note.visible ? 'Hide this note from the screen' : 'Show this note on screen'
      },
      [icon(note.visible ? 'eye-off' : 'eye'), el('span', { class: 'sr-only', text: note.visible ? 'Hide' : 'Open' })]
    );
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (note.visible) hideNote(note);
      else openNote(note);
    });

    const clickThrough = note.clickThrough
      ? [
          el(
            'button',
            {
              type: 'button',
              class: 'ct-btn',
              'data-clickthrough': 'on',
              title: 'Click-through is on: clicks pass through this note. Click to turn it off.',
              'aria-label': `Turn off click-through for ${title}`,
              onclick: (e) => {
                e.stopPropagation();
                setClickThrough(note, false);
              }
            },
            [icon('ghost'), el('span', { text: 'Click-through' })]
          )
        ]
      : [];

    card.append(
      check,
      el('span', { class: 'paper-dot', 'aria-hidden': 'true' }),
      el('div', { class: 'card-main' }, [titleEl, el('p', { class: 'note-snippet', text: snippet(note) || 'Empty note' }), body]),
      el('span', { class: 'card-tags', text: (note.tags || []).map((t) => `#${t}`).join('  ') }),
      ...clickThrough,
      el('div', { class: 'card-foot' }, [
        el('span', { class: 'when', text: formatRelative(note.updatedAt), title: `Edited ${new Date(note.updatedAt).toLocaleString()}` }),
        el('span', { class: 'state' }, [el('i', { class: 'dot', 'aria-hidden': 'true' }), el('span', { class: 'state-word', text: note.visible ? 'On screen' : 'Hidden' })]),
        openBtn,
        more
      ])
    );

    card.addEventListener('click', (e) => {
      if (e.target.closest('button, input')) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey) toggleSelected(note.id, !state.selected.has(note.id));
      focusCard(note.id);
    });
    card.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input, .note-title')) return;
      openNote(note);
    });
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      focusCard(note.id);
      openNoteMenu(note, { point: { x: e.clientX, y: e.clientY } });
    });
    return card;
  }

  function renderNotes() {
    if (state.renamingId || !els.menu.classList.contains('hidden')) {
      state.pendingRender = true;
      return;
    }
    state.pendingRender = false;
    const signature = JSON.stringify([state.layout, state.notes, [...state.selected], state.bootstrap.colors.length]);
    const hadFocus = els.noteList.contains(document.activeElement);
    if (signature !== state.renderedSignature) {
      state.renderedSignature = signature;
      els.noteList.classList.toggle('board', state.layout === 'board');
      els.noteList.classList.toggle('list', state.layout === 'list');
      els.noteList.replaceChildren(...state.notes.map(noteCard));
      const cards = cardEls();
      const keep = cards.find((c) => c.dataset.noteId === state.focusId) || cards[0];
      if (keep) keep.tabIndex = 0;
      if (hadFocus && keep) keep.focus();
    }
    els.noteList.hidden = state.notes.length === 0;
    els.empty.classList.toggle('hidden', state.notes.length > 0);
    if (!state.notes.length) renderEmptyState();
    renderHeader();
    updateBulkUi();
    fitCardBodies();
  }

  /**
   * Board previews end at the last paragraph, list item, or table row that
   * fits the card; a paragraph cut by the card's edge is clamped to whole lines.
   */
  function fitCardBodies() {
    if (state.layout !== 'board') return;
    for (const body of els.noteList.querySelectorAll('.card-body')) {
      const limit = body.getBoundingClientRect().bottom + 0.5;
      for (const block of body.children) {
        const items = block.matches('ul, ol') ? block.children : block.matches('table') ? block.querySelectorAll('tr') : [block];
        for (const node of items) {
          node.style.visibility = '';
          node.classList.remove('clamped');
          const box = node.getBoundingClientRect();
          if (box.bottom <= limit) continue;
          const lines = Math.floor((limit - box.top) / parseFloat(getComputedStyle(node).lineHeight));
          if (block === node && lines >= 1 && node.matches('p, blockquote')) {
            node.classList.add('clamped');
            node.style.setProperty('--lines', String(lines));
          } else {
            node.style.visibility = 'hidden';
          }
        }
      }
    }
  }

  function setLayout(layout) {
    if (layout === state.layout) return;
    state.layout = layout;
    els.btnBoard.setAttribute('aria-pressed', String(layout === 'board'));
    els.btnList.setAttribute('aria-pressed', String(layout === 'list'));
    renderNotes();
    api.updateSettings({ managerView: layout }).catch(() => {});
  }

  // ---------- note actions ----------

  function openNote(note) {
    return run('Could not open the note', () => api.openNote(note.id));
  }

  function hideNote(note) {
    return run('Could not hide the note', () => api.hideNote(note.id));
  }

  function setClickThrough(note, on) {
    return run('Could not change click-through', () => updateNoteOrThrow(note.id, { clickThrough: on }));
  }

  async function updateNoteOrThrow(id, patch) {
    const result = await api.updateNote(id, patch);
    if (!result || result.__saveError) throw new Error((result && result.__saveError) || 'This note no longer exists.');
    return result;
  }

  async function exportMarkdown(note) {
    try {
      const filePath = await api.exportMarkdown(note.id);
      if (filePath) showToast(`Exported “${note.title || 'Untitled'}” to ${filePath}`);
    } catch (err) {
      showActionError('Export failed', err, () => exportMarkdown(note));
    }
  }

  async function duplicateNote(note) {
    const copy = await run('Could not duplicate the note', () => api.duplicateNote(note.id));
    if (copy) state.focusId = copy.id;
  }

  /** Move notes to the trash, with Undo in the toast. */
  async function trashNotes(notes) {
    const done = [];
    const cards = cardEls();
    const lastIndex = Math.max(...notes.map((n) => cards.findIndex((c) => c.dataset.noteId === n.id)));
    const after = cards.slice(lastIndex + 1).find((c) => !notes.some((n) => n.id === c.dataset.noteId));
    try {
      for (const note of notes) {
        await api.trashNote(note.id);
        done.push(note);
        state.selected.delete(note.id);
      }
    } catch (err) {
      showActionError('Could not move the note to the trash', err);
    }
    if (after) state.focusId = after.dataset.noteId;
    if (done.length) {
      const message =
        done.length === 1
          ? `“${done[0].title || 'Untitled'}” moved to the trash`
          : `${plural(done.length, 'note')} moved to the trash`;
      showToast(message, { label: 'Undo', onClick: () => restoreNotes(done) });
    }
    await reload();
  }

  /** Bring notes back from the trash and reopen the ones that were on screen. */
  async function restoreNotes(notes) {
    await run('Could not restore the note', async () => {
      for (const note of notes) {
        await api.restoreNote(note.id);
        if (note.visible) await api.openNote(note.id);
      }
    });
  }

  function openNoteMenu(note, where) {
    const colors = (state.bootstrap && state.bootstrap.colors) || [];
    const items = [
      note.visible
        ? { label: 'Bring to front', icon: 'eye', hint: keyHint('Enter'), onSelect: () => openNote(note) }
        : { label: 'Show on screen', icon: 'eye', hint: keyHint('Enter'), onSelect: () => openNote(note) }
    ];
    if (note.visible) items.push({ label: 'Hide', icon: 'eye-off', onSelect: () => hideNote(note) });
    items.push(
      'sep',
      { label: 'Rename', icon: 'pencil', hint: 'F2', onSelect: () => startRename(note.id) },
      { label: 'Edit tags…', icon: 'tag', onSelect: () => promptTags(note) },
      {
        swatches: colors,
        current: note.color,
        label: 'Paper',
        onPick: (color) => run('Could not change the color', () => updateNoteOrThrow(note.id, { color }))
      },
      'sep'
    );
    if (state.workspaces.length > 1) {
      items.push({ label: 'Move to workspace…', icon: 'folder-input', onSelect: () => promptMoveNote(note) });
    }
    items.push(
      { label: 'Duplicate', icon: 'copy', onSelect: () => duplicateNote(note) },
      { label: 'Export as Markdown…', icon: 'file-output', onSelect: () => exportMarkdown(note) }
    );
    if (note.clickThrough) {
      items.push({ label: 'Turn off click-through', icon: 'ghost', onSelect: () => setClickThrough(note, false) });
    }
    items.push('sep', {
      label: 'Move to trash',
      icon: 'trash-2',
      hint: keyHint('Delete'),
      danger: true,
      onSelect: () => trashNotes([note])
    });
    openMenu(items, { ...where, label: `Actions for ${note.title || 'Untitled'}` });
  }

  function startRename(noteId) {
    const card = cardEl(noteId);
    const note = noteById(noteId);
    if (!card || !note) return;
    const titleEl = card.querySelector('.note-title');
    const input = el('input', { class: 'title-edit', maxlength: '200', 'aria-label': 'Note title' });
    input.value = note.title || '';
    state.renamingId = noteId;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const value = input.value.trim() || 'Untitled';
      try {
        if (save && value !== note.title) await updateNoteOrThrow(noteId, { title: value });
      } catch (err) {
        showActionError('Could not rename the note', err);
      }
      state.renamingId = null;
      state.renderedSignature = '';
      await reload();
      focusCard(noteId);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    for (const type of ['click', 'dblclick', 'mousedown']) input.addEventListener(type, (e) => e.stopPropagation());
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
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') els.modalFooter.querySelector('.primary-btn').click();
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
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') els.modalFooter.querySelector('.primary-btn').click();
    });
  }

  function confirmDeleteWorkspace(ws) {
    const count = state.allNotes.filter((n) => n.workspaceId === ws.id).length;
    openModal({
      title: 'Delete workspace?',
      body: el('p', {}, [
        'Delete ',
        el('strong', { text: ws.name }),
        count
          ? `? Its ${plural(count, 'note')} ${count === 1 ? 'moves' : 'move'} to the trash, where you can restore ${count === 1 ? 'it' : 'them'} for ${TRASH_DAYS} days.`
          : '? It has no notes.'
      ]),
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Delete workspace',
          danger: true,
          onClick: async () => {
            await api.deleteWorkspace(ws.id);
            closeModal();
            await reload();
            showToast(
              count ? `Workspace “${ws.name}” deleted. ${plural(count, 'note')} moved to the trash.` : `Workspace “${ws.name}” deleted.`,
              count ? { label: 'View trash', onClick: () => showView('trash') } : null
            );
          }
        }
      ]
    });
  }

  function promptNewWorkspace() {
    const input = el('input', { id: 'mWsNew', placeholder: 'e.g. Work', maxlength: '80' });
    openModal({
      title: 'New workspace',
      body: field('Name', input, 'Workspaces keep sets of notes apart, for example per client or project.'),
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Create',
          primary: true,
          onClick: async () => {
            const ws = await api.createWorkspace(input.value.trim() || 'New workspace');
            await api.setActiveWorkspace(ws.id);
            closeModal();
            showView('notes');
            await reload();
          }
        }
      ]
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') els.modalFooter.querySelector('.primary-btn').click();
    });
  }

  function createNote(templateId) {
    return run('Could not create a note', () =>
      api.createNote({ templateId: templateId || 'blank', workspaceId: state.activeWorkspaceId })
    );
  }

  // ---------- trash ----------

  function renderTrash() {
    const list = [...state.trash].sort((a, b) => Date.parse(b.trashedAt) - Date.parse(a.trashedAt));
    els.trashList.replaceChildren(
      ...list.map((note) => {
        const title = note.title || 'Untitled';
        const age = Math.floor((Date.now() - Date.parse(note.trashedAt)) / 86400000);
        const left = Math.max(1, TRASH_DAYS - age);
        const row = el('article', { class: 'note-card', role: 'listitem', 'data-note-id': note.id }, [
          el('span', { class: 'paper-dot', 'aria-hidden': 'true' }),
          el('h3', { class: 'note-title', text: title }),
          el('p', { class: 'note-snippet', text: snippet(note) || 'Empty note' }),
          el('span', {
            class: 'trash-left',
            text: `Deleted ${formatRelative(note.trashedAt)} · ${plural(left, 'day')} left`
          }),
          el('div', { class: 'trash-actions' }, [
            el('button', {
              type: 'button',
              class: 'text-btn',
              text: 'Restore',
              'aria-label': `Restore ${title}`,
              onclick: () => restoreFromTrash(note)
            }),
            el('button', {
              type: 'button',
              class: 'text-btn danger',
              text: 'Delete forever',
              'aria-label': `Delete ${title} forever`,
              onclick: () => confirmDeleteForever(note)
            })
          ])
        ]);
        row.style.setProperty('--tint', colorOf(note.color).hex);
        return row;
      })
    );
    els.trashList.hidden = list.length === 0;
    els.trashEmpty.classList.toggle('hidden', list.length > 0);
    els.btnEmptyTrash.disabled = list.length === 0;
  }

  async function restoreFromTrash(note) {
    const restored = await run('Could not restore the note', () => api.restoreNote(note.id));
    if (!restored) return;
    const ws = state.workspaces.find((w) => w.id === restored.workspaceId);
    showToast(`Restored “${note.title || 'Untitled'}”${ws ? ` to ${ws.name}` : ''}`, {
      label: 'Show it',
      onClick: () => openNote(restored)
    });
  }

  function confirmDeleteForever(note) {
    openModal({
      title: 'Delete forever?',
      body: el('p', {}, ['Delete ', el('strong', { text: note.title || 'Untitled' }), ' for good? This cannot be undone.']),
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Delete forever',
          danger: true,
          onClick: async () => {
            await api.deleteNote(note.id);
            closeModal();
            await reload();
          }
        }
      ]
    });
  }

  function confirmEmptyTrash() {
    const n = state.trash.length;
    openModal({
      title: 'Empty the trash?',
      body: el('p', { text: `${plural(n, 'note')} will be deleted for good. This cannot be undone.` }),
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Empty trash',
          danger: true,
          onClick: async () => {
            await api.emptyTrash();
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
    app: 'Only in Ghost Notetaker',
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

  function shortcutsSection() {
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
            : s.display
              ? el('span', { class: 'kbd', text: s.display })
              : el('span', { class: 'field-hint', text: 'Not set' });
          const statusClass = ['active', 'local', 'app'].includes(s.status) ? 'ok' : s.status === 'off' ? '' : 'bad';
          let scopeCell;
          if (s.canBeGlobal) {
            const scope = s.effectiveScope === 'app' ? 'app' : 'global';
            const setScope = async (value) => {
              try {
                render(null, await api.setShortcutScope(s.id, value));
                flashSaved();
              } catch (err) {
                render(errorMessage(err));
              }
            };
            const scopeBtn = el(
              'button',
              {
                type: 'button',
                class: 'menu-btn',
                'aria-haspopup': 'menu',
                'aria-expanded': 'false',
                'aria-label': `Where ${s.label} works`,
                'data-menu-align': 'start'
              },
              [el('span', { text: scope === 'app' ? 'In Ghost Notetaker' : 'Everywhere' }), icon('chevron-down')]
            );
            scopeBtn.addEventListener('click', () => {
              if (anchorJustClosed(scopeBtn)) return;
              openMenu(
                [
                  { label: 'Everywhere', checked: scope === 'global', onSelect: () => setScope('global') },
                  { label: 'In Ghost Notetaker', checked: scope === 'app', onSelect: () => setScope('app') }
                ],
                { anchor: scopeBtn, label: `Where ${s.label} works` }
              );
            });
            scopeCell = scopeBtn;
          } else {
            scopeCell = el('span', { class: 'field-hint', text: 'In a focused note' });
          }
          return el('tr', {}, [
            el('td', { text: s.label }),
            el('td', {}, [keyCell]),
            el('td', {}, [scopeCell]),
            el('td', { class: `status ${statusClass}`, text: STATUS_TEXT[s.status] || s.status }),
            el('td', { class: 'row-actions' }, [
              el('button', {
                type: 'button',
                class: 'text-btn',
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
                class: 'text-btn',
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
          el('thead', {}, [el('tr', {}, ['Action', 'Shortcut', 'Works', 'Status', ''].map((h) => el('th', { text: h })))]),
          el('tbody', {}, rows)
        );
      };
      if (list) draw(list);
      else api.listShortcuts().then(draw);
    }

    render();
    return settingsSection('setShortcuts', 'Keyboard shortcuts', null, [
      table,
      el('div', { class: 'set-block' }, [
        message,
        el('p', {
          class: 'field-hint',
          text: '“Everywhere” shortcuts work while other apps are focused. A shortcut that another app or the OS already uses cannot be registered; pick a different one, or limit it to Ghost Notetaker windows.'
        }),
        el('div', { class: 'button-row' }, [
          el('button', {
            type: 'button',
            id: 'btnResetShortcuts',
            class: 'hairline-btn',
            text: 'Reset to defaults',
            onclick: async () => {
              try {
                render(null, await api.resetShortcuts());
                flashSaved();
              } catch (err) {
                render(errorMessage(err));
              }
            }
          })
        ])
      ])
    ]);
  }

  // ---------- settings ----------

  function flashSaved() {
    els.settingsSaved.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      els.settingsSaved.hidden = true;
    }, 1500);
  }

  async function saveSettings(patch) {
    try {
      const s = await api.updateSettings(patch);
      state.bootstrap.settings = s;
      flashSaved();
      return s;
    } catch (err) {
      showActionError('Could not save the setting', err);
      syncSettings();
      return null;
    }
  }

  function settingsSection(id, title, aside, children) {
    return el('section', { class: 'set-section', id, 'aria-labelledby': `${id}H` }, [
      el('h2', { class: 'section-label', id: `${id}H` }, [title, ...(aside ? [el('span', { class: 'section-aside', text: aside })] : [])]),
      ...children
    ]);
  }

  function setRow({ label, hint, control, forId, disabled }) {
    return el('div', { class: `set-row${disabled ? ' disabled' : ''}` }, [
      el('div', { class: 'set-label' }, [
        forId ? el('label', { for: forId, text: label }) : el('strong', { text: label }),
        ...(hint ? [el('p', { class: 'field-hint', text: hint })] : [])
      ]),
      el('div', { class: 'set-control' }, [control])
    ]);
  }

  function switchControl(id, onChange) {
    const input = el('input', { type: 'checkbox', id, role: 'switch' });
    input.addEventListener('change', () => onChange(input.checked));
    return el('span', { class: 'switch' }, [input, el('span', { class: 'track', 'aria-hidden': 'true' })]);
  }

  function themeOption(value, label) {
    return el('button', {
      type: 'button',
      class: 'seg-btn theme-option',
      role: 'radio',
      'aria-checked': 'false',
      'data-theme': value,
      text: label,
      onclick: async () => {
        markTheme(value);
        if (await saveSettings({ theme: value })) await reload();
      }
    });
  }

  function markTheme(value) {
    for (const b of els.settingsBody.querySelectorAll('.theme-option')) {
      b.setAttribute('aria-checked', String(b.dataset.theme === value));
    }
  }

  function saveFontSize(value) {
    const font = $('sFont');
    const size = Math.min(28, Math.max(10, Math.round(Number(value) || 14)));
    font.value = String(size);
    saveSettings({ defaultFontSize: size });
  }

  function renderSettings() {
    const boot = state.bootstrap;
    const caps = boot.capabilities;
    const linuxOnly = 'Not available on Linux.';
    const colors = boot.colors || [];

    const swatches = el(
      'div',
      { class: 'swatches', id: 'sColor', role: 'radiogroup', 'aria-label': 'Paper for new notes' },
      colors.map((c) =>
        el('button', {
          type: 'button',
          class: 'swatch-btn',
          role: 'radio',
          'aria-checked': 'false',
          'aria-label': c.label,
          title: c.label,
          'data-color': c.id,
          style: `background-color:${c.hex}`,
          onclick: () => {
            markSwatch(c.id);
            saveSettings({ defaultColor: c.id });
          }
        })
      )
    );

    const opacity = el('input', { id: 'sOpacity', type: 'range', min: '25', max: '100' });
    const opacityOut = el('output', { for: 'sOpacity', id: 'sOpacityOut' });
    opacity.addEventListener('input', () => {
      opacityOut.textContent = `${opacity.value}%`;
    });
    opacity.addEventListener('change', () => saveSettings({ defaultOpacity: Number(opacity.value) / 100 }));

    const font = el('input', { id: 'sFont', type: 'number', min: '10', max: '28', 'aria-label': 'Text size in pixels' });
    font.addEventListener('change', () => saveFontSize(font.value));
    const step = (delta, name, label) =>
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': label, onclick: () => saveFontSize(Number(font.value) + delta) }, [icon(name)]);
    const stepper = el('div', { class: 'stepper' }, [step(-1, 'minus', 'Smaller text'), font, step(1, 'plus', 'Larger text')]);

    const protectHint = caps.contentProtection
      ? isMac()
        ? 'Best effort: apps that capture with ScreenCaptureKit can still record these windows.'
        : 'Uses the Windows capture-exclusion flag (Windows 10 2004 or later). Test your own call or recording app.'
      : `${linuxOnly} Notes appear in screenshots, recordings, and screen shares.`;

    const capability = (ok, text) =>
      el('li', { class: ok ? 'yes' : 'no' }, [el('i', { class: 'dot', 'aria-hidden': 'true' }), el('span', { text })]);

    const keys = [
      ['/', 'Search notes'],
      [`${modLabel()}N`, 'New note'],
      ['← → ↑ ↓', 'Move between notes'],
      [keyHint('Enter'), 'Show the note on screen'],
      ['Space', 'Select or unselect'],
      ['F2', 'Rename'],
      [keyHint('Delete'), 'Move to the trash (Undo in the message that appears)'],
      ['Esc', 'Clear the search or selection; leave Settings and Trash']
    ];

    els.settingsBody.replaceChildren(
      settingsSection('setAppearance', 'Appearance', null, [
        setRow({
          label: 'Theme',
          hint: 'System follows your computer’s light or dark setting. Notes keep their own paper colors.',
          control: el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Theme' }, [
            themeOption('system', 'System'),
            themeOption('light', 'Light'),
            themeOption('dark', 'Dark')
          ])
        })
      ]),
      settingsSection('setNotes', 'New notes', 'Applies to notes you create from now on', [
        setRow({ label: 'Paper', control: swatches }),
        setRow({ label: 'Opacity', forId: 'sOpacity', control: el('div', { class: 'range-row' }, [opacity, opacityOut]) }),
        setRow({ label: 'Text size', forId: 'sFont', control: stepper }),
        setRow({ label: 'Monospace', forId: 'sMono', control: switchControl('sMono', (v) => saveSettings({ defaultMonospace: v })) }),
        setRow({
          label: 'Show formatted Markdown when not editing',
          forId: 'sFormatted',
          hint: 'Notes show headings, lists, tables, and images until you click into the text. Turn off to always show the Markdown source.',
          control: switchControl('sFormatted', (v) => saveSettings({ formattedWhenIdle: v }))
        })
      ]),
      settingsSection('setPrivacy', 'Privacy and behavior', null, [
        setRow({
          label: 'Hide notes and this window from screen capture',
          forId: 'sProtect',
          hint: protectHint,
          disabled: !caps.contentProtection,
          control: switchControl('sProtect', (v) => saveSettings({ contentProtection: v }))
        }),
        setRow({
          label: 'Click-through for all notes (ghost mode)',
          forId: 'sClick',
          hint: caps.clickThroughHover
            ? 'Clicks pass through every note. Hover a note’s top bar to use its buttons.'
            : 'Clicks pass through every note. On Linux, turn it off here or from the tray menu.',
          control: switchControl('sClick', (v) => saveSettings({ globalClickThrough: v }))
        }),
        setRow({
          label: 'Launch at login',
          forId: 'sLogin',
          hint: caps.launchAtLogin ? '' : linuxOnly,
          disabled: !caps.launchAtLogin,
          control: switchControl('sLogin', (v) => saveSettings({ launchAtLogin: v }))
        })
      ]),
      shortcutsSection(),
      backupsSection(),
      settingsSection('setData', 'Data', null, [
        el('div', { class: 'set-block' }, [
          el('p', { class: 'data-path' }, ['Notes are saved on this computer in ', el('code', { text: boot.dataFile }), '.']),
          el('p', {
            class: 'field-hint',
            text: 'Ghost Notetaker makes no network requests of its own. Exports include pasted images, so one file holds a whole notebook.'
          }),
          el('div', { class: 'button-row' }, [
            el('button', { type: 'button', id: 'btnExport', class: 'hairline-btn', onclick: exportAll }, ['Export all notes…']),
            el('button', { type: 'button', id: 'btnImport', class: 'hairline-btn', onclick: promptImport }, ['Import backup…']),
            el('button', { type: 'button', id: 'btnRevealData', class: 'hairline-btn', onclick: () => api.revealDataFile() }, ['Show notes file'])
          ])
        ])
      ]),
      settingsSection('setAbout', 'About', `Ghost Notetaker ${boot.version}`, [
        el('div', { class: 'set-block' }, [
          el('ul', { class: 'caps-list' }, [
            capability(caps.contentProtection, caps.contentProtection ? 'Notes can be hidden from screen capture (best effort; test your own apps).' : `Screen-capture hiding: ${linuxOnly}`),
            capability(caps.clickThroughHover, caps.clickThroughHover ? 'Click-through notes still respond when you hover the top bar.' : 'Click-through notes ignore the mouse until you turn click-through off.'),
            capability(caps.launchAtLogin, caps.launchAtLogin ? 'Can start when you log in.' : `Launch at login: ${linuxOnly}`)
          ])
        ]),
        el('div', { class: 'set-block' }, [
          el('h3', { class: 'section-label', text: 'Notes Manager keys' }),
          el('div', { class: 'keys-grid' }, keys.flatMap(([k, d]) => [el('kbd', { text: k }), el('span', { text: d })]))
        ])
      ])
    );
    syncSettings();
    loadBackups();
  }

  function markSwatch(id) {
    for (const b of els.settingsBody.querySelectorAll('#sColor .swatch-btn')) {
      b.setAttribute('aria-checked', String(b.dataset.color === id));
    }
  }

  /** Copy saved settings into the controls without rebuilding the page. */
  function syncSettings() {
    if (!els.settingsBody.firstChild) return;
    const s = state.bootstrap.settings;
    const caps = state.bootstrap.capabilities;
    markTheme(s.theme || 'system');
    markSwatch(s.defaultColor);
    const opacity = $('sOpacity');
    if (opacity && document.activeElement !== opacity) {
      opacity.value = String(Math.round((s.defaultOpacity || 1) * 100));
      $('sOpacityOut').textContent = `${opacity.value}%`;
    }
    const font = $('sFont');
    if (font && document.activeElement !== font) font.value = String(s.defaultFontSize || 14);
    const setCheck = (id, value, enabled = true) => {
      const box = $(id);
      if (!box) return;
      box.disabled = !enabled;
      box.checked = Boolean(value) && enabled;
    };
    setCheck('sMono', s.defaultMonospace);
    setCheck('sFormatted', s.formattedWhenIdle !== false);
    setCheck('sProtect', s.contentProtection !== false, caps.contentProtection);
    setCheck('sClick', s.globalClickThrough);
    setCheck('sLogin', s.launchAtLogin, caps.launchAtLogin);
  }

  function updateSettingsNav() {
    const sections = Array.from(els.settingsBody.querySelectorAll('.set-section'));
    const y = els.settingsScroller.scrollTop + 40;
    let current = sections[0];
    for (const s of sections) if (s.offsetTop <= y) current = s;
    const atEnd = els.settingsScroller.scrollTop + els.settingsScroller.clientHeight >= els.settingsScroller.scrollHeight - 4;
    if (atEnd && sections.length) current = sections[sections.length - 1];
    for (const a of document.querySelectorAll('.settings-nav a')) {
      a.classList.toggle('current', Boolean(current) && a.getAttribute('href') === `#${current.id}`);
    }
    if (state.view === 'settings' && current) {
      els.btnShortcuts.classList.toggle('active', current.id === 'setShortcuts');
      els.btnSettings.classList.toggle('active', current.id !== 'setShortcuts');
    }
  }

  els.settingsScroller.addEventListener('scroll', updateSettingsNav, { passive: true });
  for (const a of document.querySelectorAll('.settings-nav a')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = $(a.getAttribute('href').slice(1));
      if (target) els.settingsScroller.scrollTo({ top: target.offsetTop - 12, behavior: 'smooth' });
    });
  }

  // ---------- backups ----------

  const backupList = el('ul', { class: 'backup-list', id: 'backupList' });

  function backupsSection() {
    return settingsSection('setBackups', 'Backups', null, [
      el('div', { class: 'set-block' }, [
        el('p', {
          class: 'field-hint',
          text: 'Once a day Ghost Notetaker copies your notes file into the backups folder and keeps the 10 newest copies. Restoring replaces every note and workspace; a copy of your current notes is made first, so a restore can be undone.'
        }),
        el('div', { class: 'button-row' }, [
          el('button', { type: 'button', id: 'btnBackupNow', class: 'hairline-btn', onclick: backupNow }, ['Back up now']),
          el('button', { type: 'button', id: 'btnRevealBackups', class: 'hairline-btn', onclick: () => api.revealBackups() }, ['Open backups folder'])
        ])
      ]),
      backupList
    ]);
  }

  async function loadBackups() {
    try {
      state.backups = await api.listBackups();
    } catch (err) {
      state.backups = [];
    }
    if (!state.backups.length) {
      backupList.replaceChildren(el('li', { class: 'muted-item', text: 'No backups yet.' }));
      return;
    }
    backupList.replaceChildren(
      ...state.backups.map((b) => {
        const when = new Date(b.modifiedAt);
        const label = when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        return el('li', { 'data-backup': b.name }, [
          el('span', { class: 'when-col', text: label }),
          el('span', { class: 'size-col', text: formatBytes(b.size) }),
          el('button', {
            type: 'button',
            class: 'text-btn',
            text: 'Restore…',
            'aria-label': `Restore the backup from ${label}`,
            onclick: () => confirmRestore(b, label)
          })
        ]);
      })
    );
  }

  async function backupNow() {
    try {
      const name = await api.createBackup();
      await loadBackups();
      showToast(name ? 'Backup saved' : 'Nothing to back up yet');
    } catch (err) {
      showActionError('Backup failed', err, backupNow);
    }
  }

  function confirmRestore(backup, label) {
    openModal({
      title: 'Restore this backup?',
      body: [
        el('p', {}, ['Replace all notes and workspaces with the backup from ', el('strong', { text: label }), '?']),
        el('p', { class: 'field-hint', text: 'Your current notes are saved as a new backup first. Restored notes start hidden; open them from the Notes Manager.' })
      ],
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Restore backup',
          danger: true,
          onClick: async () => {
            const result = await api.restoreBackup(backup.name);
            closeModal();
            state.selected.clear();
            showToast(
              `Restored ${plural(result.imported, 'note')} from ${label}`,
              result.safety
                ? {
                    label: 'Undo',
                    onClick: async () => {
                      try {
                        await api.restoreBackup(result.safety);
                        await reload();
                        await loadBackups();
                        showToast('Restore undone');
                      } catch (err) {
                        showActionError('Could not undo the restore', err);
                      }
                    }
                  }
                : null
            );
            await reload();
            await loadBackups();
          }
        }
      ]
    });
  }

  // ---------- data ----------

  async function exportAll() {
    try {
      const result = await api.exportAll();
      if (result) showToast(`Exported ${plural(result.notes, 'note')} to ${result.filePath}`);
    } catch (err) {
      showActionError('Export failed', err, exportAll);
    }
  }

  async function runImport(mode) {
    try {
      const result = await api.importAll(mode);
      if (result == null) return;
      await reload();
      const lines = [`${plural(result.imported, 'note')} imported. Imported notes start hidden; open them from this list.`];
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
    const seq = ++listSeq;
    const filter = {
      workspaceId: state.activeWorkspaceId,
      tag: state.selectedTag || undefined,
      query: state.query || undefined,
      sortBy: state.sortBy
    };
    if (state.visibility === 'open') filter.visible = true;
    if (state.visibility === 'hidden') filter.visible = false;
    const notes = await api.listNotes(filter);
    if (seq !== listSeq) return;
    state.notes = notes;
    const ids = new Set(notes.map((n) => n.id));
    for (const id of [...state.selected]) {
      if (!ids.has(id)) state.selected.delete(id);
    }
    renderNotes();
  }

  async function reload() {
    const seq = ++reloadSeq;
    const boot = await api.getBootstrap();
    const [allNotes, trash, recent] = await Promise.all([
      api.listNotes({}),
      api.listNotes({ trashed: true }),
      api.getRecent(6)
    ]);
    const tags = await api.getTags(boot.activeWorkspaceId);
    if (seq !== reloadSeq) return;
    state.bootstrap = boot;
    document.documentElement.dataset.theme = boot.darkMode ? 'dark' : 'light';
    document.documentElement.dataset.platform = boot.platform;
    if (boot.accentColor) document.documentElement.style.setProperty('--accent', boot.accentColor);
    state.workspaces = boot.workspaces;
    state.activeWorkspaceId = boot.activeWorkspaceId;
    state.allNotes = allNotes;
    state.trash = trash;
    state.recent = recent;
    state.tags = tags;
    if (boot.settings.sortBy) {
      state.sortBy = boot.settings.sortBy;
      els.sortLabel.textContent = (SORTS.find((x) => x.value === state.sortBy) || SORTS[0]).label;
    }
    if (state.selectedTag && !tags.includes(state.selectedTag)) state.selectedTag = null;
    renderSaveBanner(boot.saveError);
    await reloadNotesOnly();
    renderWorkspaces();
    renderTags();
    renderRecent();
    renderTrashCount();
    if (state.view === 'trash') renderTrash();
    if (state.view === 'settings') syncSettings();
  }

  function applySearch(value) {
    state.query = value.trim();
    state.selected.clear();
    return reloadNotesOnly();
  }

  els.search.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => applySearch(els.search.value), 120);
  });
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && state.notes.length) {
      e.preventDefault();
      focusCard(state.focusId);
    }
  });

  for (const btn of document.querySelectorAll('[data-visibility]')) {
    btn.addEventListener('click', async () => {
      state.visibility = btn.dataset.visibility;
      state.selected.clear();
      await reloadNotesOnly();
    });
  }

  els.sortBy.addEventListener('click', () => {
    if (anchorJustClosed(els.sortBy)) return;
    openMenu(
      SORTS.map((sort) => ({
        label: sort.label,
        checked: sort.value === state.sortBy,
        onSelect: async () => {
          state.sortBy = sort.value;
          els.sortLabel.textContent = sort.label;
          await api.updateSettings({ sortBy: sort.value });
          await reloadNotesOnly();
        }
      })),
      { anchor: els.sortBy, label: 'Sort notes' }
    );
  });

  els.btnBoard.addEventListener('click', () => setLayout('board'));
  els.noteList.addEventListener('load', fitCardBodies, true);
  let fitTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitCardBodies, 100);
  });
  els.btnList.addEventListener('click', () => setLayout('list'));

  els.selectAll.addEventListener('change', () => {
    state.selected.clear();
    if (els.selectAll.checked) state.notes.forEach((n) => state.selected.add(n.id));
    renderNotes();
  });

  const selectedNotes = () => state.notes.filter((n) => state.selected.has(n.id));

  async function bulkVisible(visible) {
    const ids = [...state.selected];
    state.selected.clear();
    await run(visible ? 'Could not show the notes' : 'Could not hide every note', () => api.bulkVisible(ids, visible));
  }

  els.btnBulkShow.addEventListener('click', () => bulkVisible(true));
  els.btnBulkHide.addEventListener('click', () => bulkVisible(false));
  els.btnBulkTrash.addEventListener('click', () => trashNotes(selectedNotes()));

  els.noteList.addEventListener('keydown', (e) => {
    const card = e.target.closest('.note-card');
    if (!card || e.target !== card) return;
    const cards = cardEls();
    const i = cards.indexOf(card);
    const note = noteById(card.dataset.noteId);
    if (!note) return;
    // Up and down follow the sort order (down each board column); left and right
    // move to the nearest card in the next board column.
    if (e.key === 'ArrowUp' && i === 0) {
      e.preventDefault();
      els.search.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusCard(cards[Math.min(cards.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))].dataset.noteId);
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.layout === 'board') {
      e.preventDefault();
      const from = card.getBoundingClientRect();
      const right = e.key === 'ArrowRight';
      const others = cards.map((c) => ({ c, r: c.getBoundingClientRect() })).filter(({ r }) => (right ? r.left > from.right : r.right < from.left));
      if (!others.length) return;
      const column = right ? Math.min(...others.map(({ r }) => r.left)) : Math.max(...others.map(({ r }) => r.left));
      const middle = (r) => r.top + r.height / 2;
      const target = others
        .filter(({ r }) => Math.abs(r.left - column) < 2)
        .sort((a, b) => Math.abs(middle(a.r) - middle(from)) - Math.abs(middle(b.r) - middle(from)))[0];
      focusCard(target.c.dataset.noteId);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusCard((e.key === 'Home' ? cards[0] : cards[cards.length - 1]).dataset.noteId);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openNote(note);
    } else if (e.key === ' ') {
      e.preventDefault();
      toggleSelected(note.id, !state.selected.has(note.id));
    } else if (e.key === 'Delete' || (isMac() && e.key === 'Backspace' && e.metaKey)) {
      e.preventDefault();
      trashNotes(state.selected.has(note.id) ? selectedNotes() : [note]);
    } else if (e.key === 'F2') {
      e.preventDefault();
      startRename(note.id);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      openNoteMenu(note, { anchor: card.querySelector('.card-more') });
    }
  });

  els.noteList.addEventListener('focusin', (e) => {
    const card = e.target.closest('.note-card');
    if (card && e.target === card) {
      state.focusId = card.dataset.noteId;
      for (const c of cardEls()) c.tabIndex = c === card ? 0 : -1;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (state.recording || !els.modal.classList.contains('hidden') || !els.menu.classList.contains('hidden')) return;
    const typing = Boolean(e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]'));
    const mod = isMac() ? e.metaKey : e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if ((mod && key === 'f') || (!typing && !mod && key === '/')) {
      e.preventDefault();
      if (state.view !== 'notes') showView('notes');
      els.search.focus();
      els.search.select();
    } else if (mod && !e.shiftKey && !e.altKey && key === 'n') {
      e.preventDefault();
      createNote('blank');
    } else if (mod && key === ',') {
      e.preventDefault();
      showView('settings');
    } else if (mod && key === 'a' && !typing && state.view === 'notes') {
      e.preventDefault();
      state.notes.forEach((n) => state.selected.add(n.id));
      renderNotes();
    } else if (e.key === 'Escape') {
      if (e.target === els.search && els.search.value) {
        e.preventDefault();
        els.search.value = '';
        applySearch('');
      } else if (state.view === 'notes' && state.selected.size) {
        state.selected.clear();
        renderNotes();
      } else if (state.view !== 'notes' && !typing) {
        showView('notes');
      }
    }
  });

  els.btnNewNote.addEventListener('click', () => createNote('blank'));
  els.btnEmptyNew.addEventListener('click', () => createNote('blank'));
  els.btnTemplates.addEventListener('click', () => {
    if (anchorJustClosed(els.btnTemplates)) return;
    openMenu(
      (state.bootstrap.templates || []).map((t) => ({
        label: t.label,
        icon: 'file-text',
        attrs: { 'data-template': t.id },
        onSelect: () => createNote(t.id)
      })),
      { anchor: els.btnTemplates, label: 'Templates' }
    );
  });
  els.btnNewWs.addEventListener('click', promptNewWorkspace);
  els.btnTrash.addEventListener('click', () => showView(state.view === 'trash' ? 'notes' : 'trash'));
  els.btnEmptyTrash.addEventListener('click', confirmEmptyTrash);
  els.btnSettings.addEventListener('click', () => showView('settings'));
  els.btnShortcuts.addEventListener('click', () => showView('settings', { section: 'setShortcuts' }));

  api.onSaveState((saveState) => renderSaveBanner(saveState.ok ? null : saveState.message));
  api.onRefresh(() => reload().catch((err) => console.error(err)));
  api.onShowShortcuts(() => showView('settings', { section: 'setShortcuts' }));
  api.onShowSettings(() => showView('settings'));

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
    const s = state.bootstrap.settings;
    state.layout = s.managerView === 'board' ? 'board' : 'list';
    els.btnBoard.setAttribute('aria-pressed', String(state.layout === 'board'));
    els.btnList.setAttribute('aria-pressed', String(state.layout === 'list'));
    els.brandSub.textContent = state.bootstrap.version;
    els.searchHint.textContent = '/';
    await reload();
    els.search.focus();
  }

  init().catch((err) => {
    console.error(err);
    showSafeError('Unable to open Notes Manager', errorMessage(err));
  });
})();
