'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function listen(channel) {
  return (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

contextBridge.exposeInMainWorld('ghostNote', {
  getBootstrap: () => ipcRenderer.invoke('store:getBootstrap'),
  getNote: (id) => ipcRenderer.invoke('notes:get', id),
  updateNote: (id, patch) => ipcRenderer.invoke('notes:update', id, patch),
  hideNote: (id) => ipcRenderer.invoke('notes:hide', id),
  setClickThrough: (id, enabled) => ipcRenderer.invoke('notes:setClickThrough', id, enabled),
  setCollapsed: (id, collapsed) => ipcRenderer.invoke('notes:setCollapsed', id, collapsed),
  moveBy: (id, dx, dy) => ipcRenderer.invoke('notes:moveBy', id, dx, dy),
  chromeHover: (id, hovering) => ipcRenderer.invoke('notes:chromeHover', id, hovering),
  createNote: (options) => ipcRenderer.invoke('notes:create', options),
  saveImage: (id, bytes) => ipcRenderer.invoke('images:save', id, bytes),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onUpdated: listen('note:updated'),
  onSettings: listen('note:settings'),
  onSaveState: listen('app:saveState')
});
