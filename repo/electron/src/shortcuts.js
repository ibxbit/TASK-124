'use strict';

const { globalShortcut } = require('electron');

const DEFAULTS = {
  globalSearch:  'Ctrl+K',
  approveAction: 'Ctrl+Return',
  exportData:    'Ctrl+Shift+E'
};

function registerShortcuts(store, getTarget) {
  const config = { ...DEFAULTS, ...(store.get('shortcuts') || {}) };
  const bind = (accel, channel) => {
    if (!accel) return;
    globalShortcut.register(accel, () => {
      const win = typeof getTarget === 'function' ? getTarget() : getTarget;
      if (!win) return;
      if (!win.isVisible()) win.show();
      win.focus();
      win.webContents.send(channel);
    });
  };
  bind(config.globalSearch,  'shortcut:global-search');
  bind(config.approveAction, 'shortcut:approve');
  bind(config.exportData,    'shortcut:export');
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

module.exports = { registerShortcuts, unregisterShortcuts, DEFAULTS };
