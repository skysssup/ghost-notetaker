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
    searchTimer: null
  };

  const els = {
    wsList: document.getElementById('wsList'),
    tagList: document.getElementById('tagList'),
    recentList: document.getElementById('recentList'),
    noteList: document.getElementById('noteList'),
    empty: document.getElementById('empty'),
    search: document.getElementById('search'),
    visibilityFilter: document.getElementById('visibilityFilter'),
    sortBy: document.getElementById('sortBy'),
    templateSelect: document.getElementById('templateSelect'),
    btnNewNote: document.getElementById('btnNewNote'),
    btnEmptyNew: document.getElementById('btnEmptyNew'),
    btnNewWs: document.getElementById('btnNewWs'),
    btnSettings: document.getElementById('btnSettings'),
    btnShortcuts: document.getElementById('btnShortcuts'),
    btnExport: document.getElementById('btnExport'),
    btnImport: document.getElementById('btnImport'),
    selectAll: document.getElementById('selectAll'),
    btnBulkShow: document.getElementById('btnBulkShow'),
    btnBulkHide: document.getElementById('btnBulkHide'),
    selCount: document.getElementById('selCount'),
    modal: document.getElementById('modal'),
    modalCard: document.getElementById('modalCard'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalFooter: document.getElementById('modalFooter'),
    modalClose: document.getElementById('modalClose')
  };

  const COLOR_MAP = {};
  let lastFocus = null;

  function colorHex(id) {
    return COLOR_MAP[id] || '#c8d6e5';
  }

  function formatRelative(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const diff = Date.now() - t;
    const sec = Math.round(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 48) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function snippet(content) {
    return String(content || '')
      .replace(/^#+\s+/gm, '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[*_`\[\]()>|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function closeModal() {
    els.modal.classList.add('hidden');
    els.modalBody.innerHTML = '';
    els.modalFooter.innerHTML = '';
    els.modalCard.classList.remove('wide');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try {
        lastFocus.focus();
      } catch (_) {
        /* element may be gone */
      }
    }
    lastFocus = null;
  }

  function openModal({ title, bodyHtml, footerButtons, wide }) {
    lastFocus = document.activeElement;
    els.modalTitle.textContent = title;
    els.modalBody.innerHTML = bodyHtml;
    els.modalFooter.innerHTML = '';
    els.modalCard.classList.toggle('wide', Boolean(wide));
    (footerButtons || []).forEach((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      btn.className = b.primary ? 'primary-btn' : b.danger ? 'danger-btn' : 'ghost-btn';
      btn.addEventListener('click', () => b.onClick(btn));
      els.modalFooter.appendChild(btn);
    });
    els.modal.classList.remove('hidden');
    const focusable = els.modalCard.querySelector('input, select, textarea, button:not(#modalClose)');
    (focusable || els.modalClose).focus();
  }

  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.modal.classList.contains('hidden')) {
      e.preventDefault();
      closeModal();
    }
  });

  function updateBulkUi() {
    const n = state.selected.size;
    els.selCount.textContent = n ? `${n} selected` : '';
    els.btnBulkShow.disabled = n === 0;
    els.btnBulkHide.disabled = n === 0;
    els.selectAll.checked = state.notes.length > 0 && n === state.notes.length;
    els.selectAll.indeterminate = n > 0 && n < state.notes.length;
  }

  function renderWorkspaces() {
    els.wsList.innerHTML = '';
    state.workspaces.forEach((ws) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ws-btn' + (ws.id === state.activeWorkspaceId ? ' active' : '');
      btn.textContent = ws.name;
      btn.addEventListener('click', async () => {
        await api.setActiveWorkspace(ws.id);
        state.activeWorkspaceId = ws.id;
        state.selectedTag = null;
        state.selected.clear();
        await reload();
      });
      li.appendChild(btn);

      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'mini-btn';
      rename.title = 'Rename';
      rename.textContent = '✎';
      rename.addEventListener('click', () => promptRenameWorkspace(ws));
      li.appendChild(rename);

      if (state.workspaces.length > 1) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'mini-btn';
        del.title = 'Delete workspace';
        del.textContent = '🗑';
        del.addEventListener('click', () => confirmDeleteWorkspace(ws));
        li.appendChild(del);
      }

      els.wsList.appendChild(li);
    });
  }

  function renderTags() {
    els.tagList.innerHTML = '';
    const all = document.createElement('li');
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'tag-btn' + (!state.selectedTag ? ' active' : '');
    allBtn.textContent = 'All tags';
    allBtn.addEventListener('click', async () => {
      state.selectedTag = null;
      state.selected.clear();
      await reloadNotesOnly();
      renderTags();
    });
    all.appendChild(allBtn);
    els.tagList.appendChild(all);

    state.tags.forEach((tag) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-btn' + (state.selectedTag === tag ? ' active' : '');
      btn.textContent = `#${tag}`;
      btn.addEventListener('click', async () => {
        state.selectedTag = tag;
        state.selected.clear();
        await reloadNotesOnly();
        renderTags();
      });
      li.appendChild(btn);
      els.tagList.appendChild(li);
    });
  }

  function renderRecent() {
    els.recentList.innerHTML = '';
    if (!state.recent.length) {
      const li = document.createElement('li');
      li.className = 'muted-item';
      li.textContent = 'No recent notes';
      els.recentList.appendChild(li);
      return;
    }
    state.recent.forEach((note) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'recent-btn';
      btn.textContent = note.title || 'Untitled';
      btn.title = note.title || 'Untitled';
      btn.addEventListener('click', async () => {
        await api.openNote(note.id);
        await reloadNotesOnly();
      });
      li.appendChild(btn);
      els.recentList.appendChild(li);
    });
  }

  function renderNotes() {
    els.noteList.innerHTML = '';
    if (!state.notes.length) {
      els.empty.classList.remove('hidden');
      updateBulkUi();
      return;
    }
    els.empty.classList.add('hidden');

    state.notes.forEach((note) => {
      const card = document.createElement('article');
      card.className = 'note-card' + (state.selected.has(note.id) ? ' selected' : '');
      card.setAttribute('role', 'listitem');

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'note-check';
      check.checked = state.selected.has(note.id);
      check.addEventListener('change', () => {
        if (check.checked) state.selected.add(note.id);
        else state.selected.delete(note.id);
        card.classList.toggle('selected', check.checked);
        updateBulkUi();
      });

      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.style.background = colorHex(note.color);

      const body = document.createElement('div');
      body.className = 'note-body';
      body.innerHTML = `
        <div class="note-title"></div>
        <div class="note-preview"></div>
        <div class="note-meta"></div>
      `;
      body.querySelector('.note-title').textContent = note.title || 'Untitled';
      body.querySelector('.note-preview').textContent = snippet(note.content) || 'Empty note';
      const meta = body.querySelector('.note-meta');
      const vis = document.createElement('span');
      vis.className = 'pill ' + (note.visible ? 'visible' : 'hidden-note');
      vis.textContent = note.visible ? 'open' : 'hidden';
      meta.appendChild(vis);
      const edited = document.createElement('span');
      edited.textContent = `Edited ${formatRelative(note.updatedAt)}`;
      meta.appendChild(edited);
      (note.tags || []).forEach((t) => {
        const p = document.createElement('span');
        p.className = 'pill';
        p.textContent = `#${t}`;
        meta.appendChild(p);
      });

      const actions = document.createElement('div');
      actions.className = 'note-actions';

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'ghost-btn';
      openBtn.textContent = note.visible ? 'Focus' : 'Open';
      openBtn.addEventListener('click', async () => {
        await api.openNote(note.id);
        await reloadNotesOnly();
      });

      const hideBtn = document.createElement('button');
      hideBtn.type = 'button';
      hideBtn.className = 'ghost-btn';
      hideBtn.textContent = 'Hide';
      hideBtn.disabled = !note.visible;
      hideBtn.addEventListener('click', async () => {
        await api.hideNote(note.id);
        await reloadNotesOnly();
      });

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'ghost-btn';
      renameBtn.textContent = 'Rename';
      renameBtn.addEventListener('click', () => promptRenameNote(note));

      const tagsBtn = document.createElement('button');
      tagsBtn.type = 'button';
      tagsBtn.className = 'ghost-btn';
      tagsBtn.textContent = 'Tags';
      tagsBtn.addEventListener('click', () => promptTags(note));

      const dupBtn = document.createElement('button');
      dupBtn.type = 'button';
      dupBtn.className = 'ghost-btn';
      dupBtn.textContent = 'Duplicate';
      dupBtn.addEventListener('click', async () => {
        await api.duplicateNote(note.id);
        await reload();
      });

      const moveBtn = document.createElement('button');
      moveBtn.type = 'button';
      moveBtn.className = 'ghost-btn';
      moveBtn.textContent = 'Move';
      moveBtn.addEventListener('click', () => promptMoveNote(note));

      const mdBtn = document.createElement('button');
      mdBtn.type = 'button';
      mdBtn.className = 'ghost-btn';
      mdBtn.textContent = 'Export MD';
      mdBtn.addEventListener('click', () => api.exportMarkdown(note.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'danger-btn';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => confirmDeleteNote(note));

      actions.append(openBtn, hideBtn, renameBtn, tagsBtn, dupBtn, moveBtn, mdBtn, delBtn);
      card.append(check, swatch, body, actions);
      els.noteList.appendChild(card);
    });
    updateBulkUi();
  }

  function promptRenameNote(note) {
    openModal({
      title: 'Rename note',
      bodyHtml: `<div class="field"><label>Title</label><input id="mTitle" value="" /></div>`,
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Save',
          primary: true,
          onClick: async () => {
            const val = document.getElementById('mTitle').value.trim();
            await api.updateNote(note.id, { title: val || 'Untitled' });
            closeModal();
            await reloadNotesOnly();
          }
        }
      ]
    });
    const input = document.getElementById('mTitle');
    input.value = note.title || '';
    input.focus();
    input.select();
  }

  function promptTags(note) {
    openModal({
      title: 'Edit tags',
      bodyHtml: `<div class="field"><label>Comma-separated tags</label><input id="mTags" /></div>`,
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Save',
          primary: true,
          onClick: async () => {
            const raw = document.getElementById('mTags').value;
            const tags = raw
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean);
            await api.updateNote(note.id, { tags });
            closeModal();
            await reload();
          }
        }
      ]
    });
    document.getElementById('mTags').value = (note.tags || []).join(', ');
  }

  function promptMoveNote(note) {
    const options = state.workspaces
      .map(
        (ws) =>
          `<option value="${escapeHtml(ws.id)}" ${ws.id === note.workspaceId ? 'selected' : ''}>${escapeHtml(ws.name)}</option>`
      )
      .join('');
    openModal({
      title: 'Move to workspace',
      bodyHtml: `<div class="field"><label>Workspace</label><select id="mMoveWs">${options}</select></div>`,
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Move',
          primary: true,
          onClick: async () => {
            const workspaceId = document.getElementById('mMoveWs').value;
            await api.updateNote(note.id, { workspaceId });
            closeModal();
            await reload();
          }
        }
      ]
    });
  }

  function confirmDeleteNote(note) {
    openModal({
      title: 'Delete note permanently?',
      bodyHtml: `<p>Delete <strong>${escapeHtml(note.title || 'Untitled')}</strong> for good? Hide keeps it around.</p>`,
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

  function promptRenameWorkspace(ws) {
    openModal({
      title: 'Rename workspace',
      bodyHtml: `<div class="field"><label>Name</label><input id="mWs" /></div>`,
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Save',
          primary: true,
          onClick: async () => {
            const name = document.getElementById('mWs').value.trim();
            if (name) await api.renameWorkspace(ws.id, name);
            closeModal();
            await reload();
          }
        }
      ]
    });
    document.getElementById('mWs').value = ws.name;
  }

  function confirmDeleteWorkspace(ws) {
    openModal({
      title: 'Delete workspace?',
      bodyHtml: `<p>Delete workspace <strong>${escapeHtml(ws.name)}</strong> and all of its notes?</p>`,
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Delete',
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

  async function showShortcuts() {
    const list = await api.listShortcuts();
    const rows = list
      .map(
        (s) => `<tr>
          <td>${escapeHtml(s.label)}</td>
          <td><span class="kbd">${escapeHtml(s.accelerator)}</span></td>
          <td class="scope">${escapeHtml(s.scope)}</td>
        </tr>`
      )
      .join('');
    openModal({
      title: 'Keyboard shortcuts',
      wide: true,
      bodyHtml: `<table class="shortcut-table">
        <thead><tr><th>Action</th><th>Shortcut</th><th>Scope</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="scope" style="margin-top:12px">Local = focused note/manager. Recovery shortcut is always global.</p>`,
      footerButtons: [{ label: 'Close', primary: true, onClick: closeModal }]
    });
  }

  async function showSettings() {
    const boot = state.bootstrap || (await api.getBootstrap());
    const s = await api.getSettings();
    const colors = (boot.colors || [])
      .map(
        (c) =>
          `<option value="${escapeHtml(c.id)}" ${s.defaultColor === c.id ? 'selected' : ''}>${escapeHtml(c.label)}</option>`
      )
      .join('');
    const launchSupported = boot.launchAtLoginSupported;
    openModal({
      title: 'Preferences',
      wide: true,
      bodyHtml: `
        <div class="settings-grid">
          <div class="field">
            <label>Default opacity (${Math.round((s.defaultOpacity || 0.88) * 100)}%)</label>
            <input id="sOpacity" type="range" min="25" max="100" value="${Math.round((s.defaultOpacity || 0.88) * 100)}" />
          </div>
          <div class="field">
            <label>Default font size</label>
            <input id="sFont" type="number" min="10" max="28" value="${s.defaultFontSize || 14}" />
          </div>
          <div class="field">
            <label>Default color</label>
            <select id="sColor">${colors}</select>
          </div>
          <div class="field">
            <label>Default sort</label>
            <select id="sSort">
              <option value="updated" ${s.sortBy === 'updated' ? 'selected' : ''}>Updated</option>
              <option value="created" ${s.sortBy === 'created' ? 'selected' : ''}>Created</option>
              <option value="title" ${s.sortBy === 'title' ? 'selected' : ''}>Title</option>
              <option value="color" ${s.sortBy === 'color' ? 'selected' : ''}>Color</option>
            </select>
          </div>
          <label class="check-row"><input type="checkbox" id="sMono" ${s.defaultMonospace ? 'checked' : ''}/> Default monospace font</label>
          <label class="check-row"><input type="checkbox" id="sClick" ${s.globalClickThrough ? 'checked' : ''}/> Global click-through (ghost mode)</label>
          <label class="check-row"><input type="checkbox" id="sProtect" ${s.contentProtection !== false ? 'checked' : ''}/> Content protection (hide from screen share)</label>
          <label class="check-row ${launchSupported ? '' : 'disabled'}"><input type="checkbox" id="sLogin" ${s.launchAtLogin ? 'checked' : ''} ${launchSupported ? '' : 'disabled'}/> Launch at login${launchSupported ? '' : ' (unsupported here)'}</label>
        </div>
        <p class="scope" style="margin-top:12px">v${escapeHtml(boot.version || '')} · data stays on disk</p>
      `,
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Save',
          primary: true,
          onClick: async () => {
            const patch = {
              defaultOpacity: Number(document.getElementById('sOpacity').value) / 100,
              defaultFontSize: Number(document.getElementById('sFont').value),
              defaultColor: document.getElementById('sColor').value,
              sortBy: document.getElementById('sSort').value,
              defaultMonospace: document.getElementById('sMono').checked,
              globalClickThrough: document.getElementById('sClick').checked,
              contentProtection: document.getElementById('sProtect').checked,
              launchAtLogin: document.getElementById('sLogin').checked
            };
            await api.updateSettings(patch);
            state.sortBy = patch.sortBy;
            els.sortBy.value = patch.sortBy;
            closeModal();
            await reload();
          }
        }
      ]
    });
  }

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
    // Drop stale selections
    const ids = new Set(state.notes.map((n) => n.id));
    for (const id of [...state.selected]) {
      if (!ids.has(id)) state.selected.delete(id);
    }
    renderNotes();
  }

  async function reload() {
    state.workspaces = await api.listWorkspaces();
    const boot = await api.getBootstrap();
    state.bootstrap = boot;
    state.activeWorkspaceId = boot.activeWorkspaceId;
    if (boot.settings && boot.settings.sortBy) {
      state.sortBy = boot.settings.sortBy;
      els.sortBy.value = state.sortBy;
    }
    state.tags = await api.getTags(state.activeWorkspaceId);
    state.recent = await api.getRecent(8);
    await reloadNotesOnly();
    renderWorkspaces();
    renderTags();
    renderRecent();
  }

  els.search.addEventListener('input', () => {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(async () => {
      state.query = els.search.value.trim();
      state.selected.clear();
      await reloadNotesOnly();
    }, 80);
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
    if (els.selectAll.checked) {
      state.notes.forEach((n) => state.selected.add(n.id));
    }
    renderNotes();
  });

  els.btnBulkShow.addEventListener('click', async () => {
    const ids = [...state.selected];
    await api.bulkVisible(ids, true);
    state.selected.clear();
    await reloadNotesOnly();
  });

  els.btnBulkHide.addEventListener('click', async () => {
    const ids = [...state.selected];
    await api.bulkVisible(ids, false);
    state.selected.clear();
    await reloadNotesOnly();
  });

  async function createFromToolbar() {
    await api.createNote({
      templateId: els.templateSelect.value || 'blank',
      workspaceId: state.activeWorkspaceId
    });
    await reload();
  }

  els.btnNewNote.addEventListener('click', createFromToolbar);
  els.btnEmptyNew.addEventListener('click', createFromToolbar);

  els.btnNewWs.addEventListener('click', () => {
    openModal({
      title: 'New workspace',
      bodyHtml: `<div class="field"><label>Name</label><input id="mWsNew" placeholder="e.g. Work" /></div>`,
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Create',
          primary: true,
          onClick: async () => {
            const name = document.getElementById('mWsNew').value.trim() || 'New workspace';
            const ws = await api.createWorkspace(name);
            await api.setActiveWorkspace(ws.id);
            closeModal();
            await reload();
          }
        }
      ]
    });
    document.getElementById('mWsNew').focus();
  });

  els.btnSettings.addEventListener('click', showSettings);
  els.btnShortcuts.addEventListener('click', showShortcuts);
  els.btnExport.addEventListener('click', () => api.exportAll());
  els.btnImport.addEventListener('click', () => {
    openModal({
      title: 'Import notes',
      bodyHtml: `<p>Import a JSON backup — merge or wipe and replace.</p>`,
      footerButtons: [
        { label: 'Cancel', onClick: closeModal },
        {
          label: 'Merge',
          onClick: async () => {
            closeModal();
            await api.importAll('merge');
            await reload();
          }
        },
        {
          label: 'Replace all',
          danger: true,
          onClick: async () => {
            closeModal();
            await api.importAll('replace');
            await reload();
          }
        }
      ]
    });
  });

  api.onRefresh(() => reload());
  api.onShowShortcuts(() => showShortcuts());
  api.onShowSettings(() => showSettings());

  async function init() {
    state.bootstrap = await api.getBootstrap();
    (state.bootstrap.colors || []).forEach((c) => {
      COLOR_MAP[c.id] = c.hex;
    });
    if (state.bootstrap.templates) {
      els.templateSelect.innerHTML = state.bootstrap.templates
        .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`)
        .join('');
    }
    if (state.bootstrap.settings && state.bootstrap.settings.sortBy) {
      state.sortBy = state.bootstrap.settings.sortBy;
      els.sortBy.value = state.sortBy;
    }
    await reload();
  }

  init().catch((err) => {
    console.error(err);
    document.body.textContent = String(err);
  });
})();
