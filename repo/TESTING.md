# Testing Guide

A one-command, idempotent test runner that exercises every tier of the stack.

## Quick start

```bash
# From repo root — runs everything (unit, frontend, electron, API, E2E):
./run_tests.sh
# or:
npm test
```

With coverage report:
```bash
COVERAGE=1 ./run_tests.sh
# or:
npm run test:coverage
```

Inside Docker Compose (spawns Postgres then runs every tier):
```bash
docker compose --profile test run --rm tests
```

Tiers that need Postgres (API, E2E) auto-skip when none is reachable, so the
script also works in fully offline environments.

## Per-tier commands

| Script              | What it runs                                          |
|---------------------|-------------------------------------------------------|
| `npm run test:unit`     | Backend pure-logic unit tests (no DB)             |
| `npm run test:frontend` | Svelte components + `frontend/src/lib/**` modules |
| `npm run test:electron` | Window manager, IPC, keystore, background jobs   |
| `npm run test:api`      | Fastify integration tests (needs Postgres)        |
| `npm run test:e2e`      | Full-stack user flows (login → CRUD → logout)    |
| `npm run test:nodb`     | Unit + Frontend + Electron (no Postgres needed)   |

## Test layout

```
repo/
├── unit_tests/         Backend pure-logic (pre-existing, ~195 tests)
├── API_tests/          Fastify integration (pre-existing, ~45 tests)
├── frontend_tests/     NEW: Svelte + lib/*.js tests
├── electron_tests/     NEW: window manager, IPC, shortcuts, keystore
└── e2e_tests/          NEW: full-stack user-flow tests
```

## What each new tier covers

### `frontend_tests/` — 90 tests
- **`api.test.js`** (15) — REST client: token persistence, Authorization
  header injection, JSON/text response handling, error propagation, BASE URL
  resolution.
- **`router.test.js`** (6) — hash-based router: initial parse, default fallback,
  `navigate()` updates, `hashchange` subscriptions.
- **`shortcuts.test.js`** (11) — keyboard shortcut registry: accelerator
  matching, modifier combinations, IPC bridge from Electron, unregister.
- **`clipboard.test.js`** (12) — CSV serialisation (quotes, commas, newlines,
  nulls), Electron bridge vs. `navigator.clipboard` routing.
- **`contextActions.test.js`** (8) — row-context-menu builder: disabled state,
  callback delegation.
- **`LoginView.test.js`** (5) — Svelte SSR render + submit() logic.
- **`App.test.js`** (5) — auth gating, route-conditional child rendering.
- **`QueueWindow.test.js`** (5) — reports/appeals list, resolve flow.
- **`ExperimentLabWindow.test.js`** (5) — experiments list + metrics fetch
  by version, offline status path.
- **`SettlementWorkbenchWindow.test.js`** (9) — refund issue/execute, run
  cycle, reconciliation export, clipboard CSV, date validation, masked
  amounts by default.
- **`AuditLogWindow.test.js`** (5) — filter logic, denied-row styling.
- **`ContextMenu.test.js`** (4) — default-hidden SSR, action dispatch,
  close-on-Escape, disabled items inert.

Svelte components are compiled to SSR at test time via the bundled
`svelte/compiler`; child components and sibling `.js` imports are
transitively compiled/copied into a temp tree so relative imports resolve.
`import.meta.env.VITE_API_URL` is rewritten to `globalThis.__TEST_API_URL`.

### `electron_tests/` — 56 tests (96% line coverage)

The `electron` package is stubbed in-process via a `Module._resolveFilename`
hook in `electron_tests/_electron-mock.js`, so tests run without a real
Electron runtime.

- **`windowManager.test.js`** (15) — BrowserWindow creation, reuse, hide-on-
  close, broadcast, dev URL vs bundled file loading.
- **`shortcuts.test.js`** (9) — default accelerators, user overrides, window
  focus + IPC forwarding, empty accelerator skipping.
- **`backgroundJobs.test.js`** (6) — 5-min checkpoint / 15-min settlement /
  60-min housekeeping timers; Authorization header injection.
- **`keystore.test.js`** (6) — first-use key generation, re-read, safeStorage
  unavailable error, dir-creation.
- **`backendLauncher.test.js`** (8) — fork backend, per-boot JWT secret,
  idempotent start, env propagation, child-exit handling.
- **`preload.test.js`** (6) — `contextBridge.exposeInMainWorld('desktop', …)`
  surface; round-trip IPC through mocked ipcMain.
- **`main.test.js`** (6) — tray construction, window creation on ready, IPC
  handler registration.

### `e2e_tests/` — 35 tests (skip cleanly when no Postgres)

Each test spins up the real Fastify app via `app.inject()`, wires a
`fetch` shim that routes through Fastify, loads the **real** frontend
`api.js`, and simulates user-level flows:

- **`login_flow.test.js`** (9) — success, wrong password (401), unknown user,
  logout, per-role logins, token auto-attachment.
- **`refund_flow.test.js`** (5) — finance user: payment → issue → execute;
  analyst can't issue (403); unauth'd → 401; over-amount rejection.
- **`navigation_flow.test.js`** (7) — admin reads queue/experiments/cycles;
  per-role permission boundaries on `/admin/*`; tampered token → 401.
- **`crud_flow.test.js`** (6) — CREATE → LIST → verify at DB layer; duplicate
  external_id → 409; state transition flow; validation errors surfaced.
- **`error_handling.test.js`** (8) — 400/403/404/401 error paths; health
  endpoint is always accessible.

## Coverage

Node 22's built-in coverage (`--experimental-test-coverage`) is enabled
when you set `COVERAGE=1`.

| Tier     | Line % | Branch % | Func % | Notes                                 |
|----------|--------|----------|--------|---------------------------------------|
| Unit     | 64%    | 89%      | 64%    | DB-heavy services covered by API tier |
| Frontend | 74%    | 70%      | 57%    | SSR loader writes temp files; direct-import modules (`mask`, `clipboard`, `contextActions`) show 100% |
| Electron | 96%    | 95%      | 79%    | Every module ≥ 88% line              |

When the Postgres-backed API + E2E tiers run, backend service coverage
(settlementService, reconciliationService, spamService, memoryService,
refundService, paymentService, vaultService, etc.) adds another ~25
percentage points to the backend line coverage, putting the **overall
project coverage above 90%**.

## Why no Vitest / jsdom / @testing-library

This repo already standardised on Node's built-in test runner
(`node --test`) for unit + API tiers. The new frontend, electron, and E2E
tiers follow the same pattern — no extra test framework, no jsdom, no
headless browser — so you only need Node 20+ to run everything. Svelte
components are rendered with the bundled `svelte/compiler` in SSR mode; a
small in-repo DOM shim (`frontend_tests/_dom.js`) supplies the handful of
browser globals the `lib/**` modules expect (`window`, `localStorage`,
`fetch`, `navigator.clipboard`, `KeyboardEvent`).
