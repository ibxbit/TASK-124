'use strict';

const { app, ipcMain, powerSaveBlocker, crashReporter } = require('electron');
const path = require('path');
const log = require('electron-log');
const { startBackend, stopBackend } = require('./ipc/backend-bridge');
const WindowManager = require('./windows/window-manager');
const CheckpointManager = require('../backend/checkpoint/checkpoint-manager');

// ─── Logging ────────────────────────────────────────────────────────────────
log.transports.file.level = 'info';
log.transports.file.resolvePathFn = () =>
  path.join(app.getPath('logs'), 'mesac.log');
log.initialize({ preload: true });

// ─── Crash reporter ──────────────────────────────────────────────────────────
crashReporter.start({
  productName: 'MESAC',
  submitURL: '', // No remote — store crash dumps locally only
  uploadToServer: false,
});

// ─── Single-instance lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.warn('Another MESAC instance is already running — exiting.');
  app.quit();
}

// ─── High-DPI / GPU ──────────────────────────────────────────────────────────
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
// Enable hardware acceleration but cap to avoid driver quirks
app.commandLine.appendSwitch('enable-gpu-rasterization');

// ─── State ────────────────────────────────────────────────────────────────────
let windowManager = null;
let checkpointManager = null;
let backendPort = 3131;
let powerBlockerId = null;
let memoryMonitorInterval = null;

const STARTUP_TIMEOUT_MS = 5000;
const MEM_MONITOR_INTERVAL_MS = 60_000;
const MEM_GROWTH_WARN_PERCENT = 15;   // warn before the 20% hard limit

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  log.info('MESAC starting — electron ready');
  const t0 = Date.now();

  // Prevent display sleep while app runs
  powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');

  // 1. Show splash / create window manager early so the user sees SOMETHING fast
  windowManager = new WindowManager({ backendPort, isDev: process.argv.includes('--dev') });
  await windowManager.showSplash();

  // 2. Start backend (embedded PG + Fastify) — races with splash display
  try {
    backendPort = await Promise.race([
      startBackend({ userDataPath: app.getPath('userData'), log }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Backend startup timeout')), STARTUP_TIMEOUT_MS)
      ),
    ]);
    log.info(`Backend ready on :${backendPort} in ${Date.now() - t0}ms`);
  } catch (err) {
    log.error('Backend failed to start:', err);
    // Offline mode — frontend will use IndexedDB cache
  }

  // 3. Restore checkpointed state
  checkpointManager = new CheckpointManager({
    dbPath: path.join(app.getPath('userData'), 'checkpoints.db'),
    log,
  });
  await checkpointManager.init();
  await checkpointManager.restoreIfNeeded();

  // 4. Open main windows
  await windowManager.openAll({ backendPort });

  // 5. Start 60-second checkpoint loop
  checkpointManager.startLoop(60_000, () => windowManager.captureState());

  // 6. Memory growth monitor
  startMemoryMonitor();

  log.info(`Full startup completed in ${Date.now() - t0}ms`);
});

app.on('second-instance', () => {
  // Focus the existing queue window when user double-clicks the icon
  if (windowManager) windowManager.focusQueue();
});

app.on('window-all-closed', async () => {
  log.info('All windows closed — shutting down');
  await shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  e.preventDefault();
  await shutdown();
  app.exit(0);
});

// ─── IPC surface ─────────────────────────────────────────────────────────────
ipcMain.handle('app:get-config', () => ({
  backendPort,
  userDataPath: app.getPath('userData'),
  version: app.getVersion(),
}));

ipcMain.handle('window:open', (_e, windowName) => {
  if (windowManager) windowManager.open(windowName);
});

ipcMain.handle('window:focus', (_e, windowName) => {
  if (windowManager) windowManager.focus(windowName);
});

ipcMain.handle('checkpoint:save', (_e, state) => {
  if (checkpointManager) checkpointManager.save(state);
});

ipcMain.handle('app:get-memory-stats', () => getMemoryStats());

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getMemoryStats() {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    externalMB: Math.round(mem.external / 1024 / 1024),
  };
}

let baselineHeapMB = null;

function startMemoryMonitor() {
  // Capture baseline after first full GC cycle
  setTimeout(() => {
    if (global.gc) global.gc();
    baselineHeapMB = process.memoryUsage().heapUsed / 1024 / 1024;
    log.info(`Memory baseline: ${baselineHeapMB.toFixed(1)} MB`);
  }, 5000);

  memoryMonitorInterval = setInterval(() => {
    const stats = getMemoryStats();
    if (baselineHeapMB !== null) {
      const growthPct = ((stats.heapUsedMB - baselineHeapMB) / baselineHeapMB) * 100;
      if (growthPct > MEM_GROWTH_WARN_PERCENT) {
        log.warn(`Memory growth ${growthPct.toFixed(1)}% — heap ${stats.heapUsedMB}MB`);
        if (global.gc) {
          global.gc();
          log.info('Forced GC triggered');
        }
      }
    }
    log.debug(`Mem — heap: ${stats.heapUsedMB}MB, rss: ${stats.rssMB}MB`);

    // Notify windows of memory stats for the status bar
    if (windowManager) windowManager.broadcastMemoryStats(stats);
  }, MEM_MONITOR_INTERVAL_MS);
}

async function shutdown() {
  log.info('Shutdown initiated');
  if (memoryMonitorInterval) clearInterval(memoryMonitorInterval);
  if (checkpointManager) await checkpointManager.flush();
  await stopBackend();
  if (powerBlockerId !== null) powerSaveBlocker.stop(powerBlockerId);
}
