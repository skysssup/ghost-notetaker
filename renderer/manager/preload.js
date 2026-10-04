'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel) {
  return (cb) => {
    const h = () => cb();
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  };
}

contextBridge.exposeInMainWorld('ghostManager', {
  getBootstrap: () => ipcRenderer.invoke('store:getBootstrap'),
  listNotes: (filter) => ipcRenderer.invoke('notes:list', filter),
  getTags: (workspaceId) => ipcRenderer.invoke('notes:tags', workspaceId),
  getRecent: (limit) => ipcRenderer.invoke('notes:recent', limit),
  createNote: (options) => ipcRenderer.invoke('notes:create', options),
  updateNote: (id, patch) => ipcRenderer.invoke('notes:update', id, patch),
  openNote: (id) => ipcRenderer.invoke('notes:open', id),
  hideNote: (id) => ipcRenderer.invoke('notes:hide', id),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id),
  trashNote: (id) => ipcRenderer.invoke('notes:trash', id),
  restoreNote: (id) => ipcRenderer.invoke('notes:restore', id),
  emptyTrash: () => ipcRenderer.invoke('notes:emptyTrash'),
  duplicateNote: (id) => ipcRenderer.invoke('notes:duplicate', id),
  bulkVisible: (ids, visible) => ipcRenderer.invoke('notes:bulkVisible', ids, visible),
  exportMarkdown: (id) => ipcRenderer.invoke('notes:exportMarkdown', id),
  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  setActiveWorkspace: (id) => ipcRenderer.invoke('workspaces:setActive', id),
  createWorkspace: (name) => ipcRenderer.invoke('workspaces:create', name),
  renameWorkspace: (id, name) => ipcRenderer.invoke('workspaces:rename', id, name),
  deleteWorkspace: (id) => ipcRenderer.invoke('workspaces:delete', id),
  exportAll: () => ipcRenderer.invoke('data:exportAll'),
  importAll: (mode) => ipcRenderer.invoke('data:importAll', mode),
  listShortcuts: () => ipcRenderer.invoke('shortcuts:list'),
  setShortcut: (id, accelerator) => ipcRenderer.invoke('shortcuts:set', id, accelerator),
  resetShortcuts: () => ipcRenderer.invoke('shortcuts:reset'),
  setShortcutScope: (id, scope) => ipcRenderer.invoke('shortcuts:setScope', id, scope),
  pauseShortcuts: (paused) => ipcRenderer.invoke('shortcuts:pause', paused),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  revealDataFile: () => ipcRenderer.invoke('app:revealDataFile'),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  createBackup: () => ipcRenderer.invoke('backups:create'),
  restoreBackup: (name) => ipcRenderer.invoke('backups:restore', name),
  revealBackups: () => ipcRenderer.invoke('app:revealBackups'),
  onSaveState: (cb) => {
    const h = (_e, state) => cb(state);
    ipcRenderer.on('app:saveState', h);
    return () => ipcRenderer.removeListener('app:saveState', h);
  },
  onRefresh: subscribe('manager:refresh'),
  onShowShortcuts: subscribe('manager:showShortcuts'),
  onShowSettings: subscribe('manager:showSettings')
});
