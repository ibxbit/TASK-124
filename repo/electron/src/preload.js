'use strict';

const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  shortcuts: {
    get: () => ipcRenderer.invoke('shortcuts:get'),
    set: (config) => ipcRenderer.invoke('shortcuts:set', config)
  },
  windows: {
    open: (id) => ipcRenderer.invoke('windows:open', id)
  },
  clipboard: {
    writeText: (text) => clipboard.writeText(text)
  },
  onShortcut: (channel, cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
