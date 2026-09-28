'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostNote', {
  getBootstrap: () => ipcRenderer.invoke('store:getBootstrap'),
  getNote: (id) => ipcRenderer.invoke('notes:get', id),
  updateNote: (id, patch) => ipcRenderer.invoke('notes:update', id, patch),
  hideNote: (id) => ipcRenderer.invoke('notes:hide', id),
  setClickThrough: (id, enabled) => ipcRenderer.invoke('notes:setClickThrough', id, enabled),
  chromeHover: (id, hovering) => ipcRenderer.invoke('notes:chromeHover', id, hovering),
  createNote: (options) => ipcRenderer.invoke('notes:create', options),
  onUpdated: (cb) => {
    const handler = (_e, note) => cb(note);
    ipcRenderer.on('note:updated', handler);
    return () => ipcRenderer.removeListener('note:updated', handler);
  }
});
