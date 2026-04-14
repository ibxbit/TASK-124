// Keyboard shortcut registry — works alongside Electron global shortcuts.
const handlers = new Map();

function matches(e, accel) {
  const parts = accel.toLowerCase().split('+');
  const needCtrl  = parts.includes('ctrl');
  const needShift = parts.includes('shift');
  const needAlt   = parts.includes('alt');
  const key = parts[parts.length - 1];
  const pressed = e.key.toLowerCase() === (key === 'return' ? 'enter' : key);
  return pressed
      && e.ctrlKey  === needCtrl
      && e.shiftKey === needShift
      && e.altKey   === needAlt;
}

export function registerShortcut(name, accel, handler) {
  handlers.set(name, { accel, handler });
}

export function unregisterShortcut(name) { handlers.delete(name); }

export function initShortcuts() {
  window.addEventListener('keydown', (e) => {
    for (const { accel, handler } of handlers.values()) {
      if (matches(e, accel)) { e.preventDefault(); handler(e); return; }
    }
  });
  if (window.desktop && window.desktop.onShortcut) {
    window.desktop.onShortcut('shortcut:global-search', () => {
      const h = handlers.get('globalSearch'); if (h) h.handler();
    });
    window.desktop.onShortcut('shortcut:approve', () => {
      const h = handlers.get('approveAction'); if (h) h.handler();
    });
    window.desktop.onShortcut('shortcut:export', () => {
      const h = handlers.get('exportData'); if (h) h.handler();
    });
  }
}
