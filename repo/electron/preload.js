'use strict';

/**
 * Preload script — runs in the renderer process with node integration
 * disabled. Exposes a narrow, typed API surface to the web content via
 * contextBridge so we never expose raw Node/Electron APIs to the UI.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mesac', {
  // ── Config ────────────────────────────────────────────────────────────────
  getConfig: () => ipcRenderer.invoke('app:get-config'),

  // ── Window management ─────────────────────────────────────────────────────
  openWindow: (name) => ipcRenderer.invoke('window:open', name),
  focusWindow: (name) => ipcRenderer.invoke('window:focus', name),

  // ── Checkpoint ────────────────────────────────────────────────────────────
  saveCheckpoint: (state) => ipcRenderer.invoke('checkpoint:save', state),

  // ── Memory stats ─────────────────────────────────────────────────────────
  getMemoryStats: () => ipcRenderer.invoke('app:get-memory-stats'),

  // ── Event subscriptions ──────────────────────────────────────────────────
  on: (channel, listener) => {
    const ALLOWED_CHANNELS = [
      'memory:stats',
      'backend:status',
      'checkpoint:restored',
    ];
    if (!ALLOWED_CHANNELS.includes(channel)) {
      console.warn(`[preload] Blocked subscribe to unknown channel: ${channel}`);
      return () => {};
    }
    const wrapped = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
});
