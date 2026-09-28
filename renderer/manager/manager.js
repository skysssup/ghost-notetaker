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
    activeWorkspaceId: null,
    selectedTag: null,
    query: ''
  };

  const els = {
    wsList: document.getElementById('wsList'),
    tagList: document.getElementById('tagList'),
    noteList: document.getElementById('noteList'),
    empty: document.getElementById('empty'),
    search: document.getElementById('search'),
    templateSelect: document.getElementById('templateSelect'),
    btnNewNote: document.getElementById('btnNewNote'),
    btnNewWs: document.getElementById('btnNewWs'),
    btnShortcuts: document.getElementById('btnShortcuts'),
    btnExport: document.getElementById('btnExport'),
    btnImport: document.getElementById('btnImport'),
    modal: document.getElementById('modal'),
    modalCard: document.getElementById('modalCard'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalFooter: document.getElementById('modalFooter'),
    modalClose: document.getElementById('modalClose')
  };

  const COLOR_MAP = {};

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

  function closeModal() {
    els.modal.classList.add('hidden');
    els.modalBody.innerHTML = '';
    els.modalFooter.innerHTML = '';
    els.modalCard.classList.remove('wide');
  }

  function openModal({ title, bodyHtml, footerButtons, wide }) {
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
  }

  els.modalClose.addEventListener('click', closeModal);
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeModal();
  });

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
        await reloadNotesOnly();
        renderTags();
      });
      li.appendChild(btn);
      els.tagList.appendChild(li);
    });
  }

  function renderNotes() {
    els.noteList.innerHTML = '';
    if (!state.notes.length) {
      els.empty.classList.remove('hidden');
      return;
    }
    els.empty.classList.add('hidden');

    state.notes.forEach((note) => {
      const card = document.createElement('article');
      card.className = 'note-card';
      card.setAttribute('role', 'listitem');

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

      actions.append(openBtn, hideBtn, renameBtn, tagsBtn, mdBtn, delBtn);
      card.append(swatch, body, actions);
      els.noteList.appendChild(card);
    });
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

  function confirmDeleteNote(note) {
    openModal({
      title: 'Delete note permanently?',
      bodyHtml: `<p>This will permanently delete <strong>${escapeHtml(note.title || 'Untitled')}</strong>. This cannot be undone. Hiding the note keeps it in your library.</p>`,
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

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
      <p class="scope" style="margin-top:12px">Local shortcuts work while a note or the Notes Manager is focused. The recovery shortcut is global so you can create a note even when everything is hidden.</p>`,
      footerButtons: [{ label: 'Close', primary: true, onClick: closeModal }]
    });
  }

  async function reloadNotesOnly() {
    state.notes = await api.listNotes({
      workspaceId: state.activeWorkspaceId,
      tag: state.selectedTag || undefined,
      query: state.query || undefined
    });
    renderNotes();
  }

  async function reload() {
    state.workspaces = await api.listWorkspaces();
    const boot = await api.getBootstrap();
    state.activeWorkspaceId = boot.activeWorkspaceId;
    state.tags = await api.getTags(state.activeWorkspaceId);
    await reloadNotesOnly();
    renderWorkspaces();
    renderTags();
  }

  els.search.addEventListener('input', async () => {
    state.query = els.search.value.trim();
    await reloadNotesOnly();
  });

  els.btnNewNote.addEventListener('click', async () => {
    await api.createNote({
      templateId: els.templateSelect.value || 'blank',
      workspaceId: state.activeWorkspaceId
    });
    await reload();
  });

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

  els.btnShortcuts.addEventListener('click', showShortcuts);
  els.btnExport.addEventListener('click', () => api.exportAll());
  els.btnImport.addEventListener('click', () => {
    openModal({
      title: 'Import notes',
      bodyHtml: `<p>Choose how to import a Ghost Notetaker JSON backup.</p>`,
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
    await reload();
  }

  init().catch((err) => {
    console.error(err);
    document.body.textContent = String(err);
  });
})();
