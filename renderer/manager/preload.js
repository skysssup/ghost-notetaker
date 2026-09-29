'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  onRefresh: (cb) => {
    const h = () => cb();
    ipcRenderer.on('manager:refresh', h);
    return () => ipcRenderer.removeListener('manager:refresh', h);
  },
  onShowShortcuts: (cb) => {
    const h = () => cb();
    ipcRenderer.on('manager:showShortcuts', h);
    return () => ipcRenderer.removeListener('manager:showShortcuts', h);
  },
  onShowSettings: (cb) => {
    const h = () => cb();
    ipcRenderer.on('manager:showSettings', h);
    return () => ipcRenderer.removeListener('manager:showSettings', h);
  }
});
