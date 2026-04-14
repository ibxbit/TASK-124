# Static Audit Review — April 14, 2026

## Advanced UI/UX & Installer Features — Static Evidence

| Feature                        | Static Evidence (File:Line)                                                                 | Status / Limitation                |
|--------------------------------|--------------------------------------------------------------------------------------------|------------------------------------|
| High-DPI scaling               | repo/electron/main.js:38-43                                                                 | Electron config present            |
| System tray mode                | —                                                                                          | **Not statically evidenced**       |
| Multi-window workflow           | repo/electron/windows/window-manager.js:7-100                                               | Fully evidenced                    |
| Deep clipboard/context menu     | frontend/src/lib/clipboard.js, ContextMenu.svelte, contextActions.js, QueueWindow.svelte   | Fully evidenced                    |
| Keyboard shortcuts              | frontend/src/lib/shortcuts.js, QueueWindow.svelte, SettlementWorkbenchWindow.svelte        | Fully evidenced                    |
| Offline update/rollback         | README.md:421-480, electron-builder.yml                                                    | Fully evidenced                    |
| Non-Docker/manual startup       | README.md:301-360                                                                          | Fully evidenced                    |
| Project structure/entry points  | README.md:36-120, 361-420                                                                  | Fully evidenced                    |

---

## Feature Gaps & Manual Verification

- **System tray mode:** Not statically evidenced. Manual runtime check required.
- **High-DPI scaling:** Electron config present, but Svelte/CSS scaling should be visually verified.
- **Installer rollback:** Rollback is at the database/application level, not the installer binary.

---

## Manual Verification Plan

- **System tray mode:** Launch the Electron app and minimize; verify tray icon and restore behavior.
- **High-DPI scaling:** Run on a high-DPI display (1920x1080+ with scaling) and visually inspect UI scaling.
- **Installer rollback:** Test rollback by applying an update, then using the admin API to roll back and verify DB state.

---

## All other requirements are evidenced in code or documentation as listed above.