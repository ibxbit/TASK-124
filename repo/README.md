# Merchant Engagement & Settlement Analytics Console

**Project type: `fullstack`** (Electron desktop + Svelte frontend + Fastify backend + PostgreSQL)

Desktop-class analytics platform for merchant moderation, A/B experimentation,
and financial settlement — designed for offline-first Windows 11 deployment.

---

## Start Command

```bash
docker-compose up
```

No `.env` edits, no manual SQL imports, no `npm install` steps. Everything is
orchestrated automatically by Docker Compose. (The modern `docker compose up`
subcommand works interchangeably.)

---

## Services & Addresses

| Service        | URL                         | Port |
|----------------|-----------------------------|------|
| **Frontend**   | http://localhost:3000       | 3000 |
| **Backend API**| http://localhost:3131       | 3131 |
| **PostgreSQL** | postgresql://localhost:5432 | 5432 |

### Demo Credentials (all roles)

Every role ships pre-seeded by the migration runner so reviewers can log in to
each persona immediately after `docker-compose up`:

| Email / Username | Password      | Role      |
|------------------|---------------|-----------|
| `admin`          | `admin`       | admin     |
| `analyst`        | `analyst123`  | analyst   |
| `moderator`      | `moderator123`| moderator |
| `finance`        | `finance123`  | finance   |

Additional users can be created via `POST /auth/register` (admin-only).

---

## Project Structure

```
repo/
├── docker-compose.yml          One-click orchestration
├── run_tests.sh                Runs all unit + API tests
├── README.md
│
├── unit_tests/                 Pure-logic tests (no DB dependency)
│   ├── queryBuilder.test.js    Analytics filter/sort/pagination
│   ├── stats.test.js           z-test / normCdf
│   ├── bucketing.test.js       Deterministic experiment bucketing
│   ├── reviewValidation.test.js Rating bounds, tags, body length
│   ├── rbac.test.js            Role-permission matrix
│   ├── finance.test.js         Fee rates, settlement week range
│   ├── exportValidation.test.js Export format/date/header validation
│   ├── exportService.test.js   CSV formatting + data consistency
│   ├── exportRowLimit.test.js  200,000-row strict enforcement
│   ├── checkpointIntegrity.test.js Canonical JSON + SHA-256
│   ├── memoryService.test.js   Growth calculation + thresholds
│   ├── startupTimer.test.js    Boot-phase timing
│   ├── spamService.test.js     Anti-spam scoring + duplicate detection
│   └── encryption.test.js      AES-256-GCM, IV uniqueness, AAD, key rotation
│
├── API_tests/                  Integration tests (Fastify + real Postgres)
│   ├── helpers.js              App bootstrap, token helper, DB seeding
│   ├── auth.test.js            Login, register, session, error codes
│   ├── rbac.test.js            Cross-role endpoint enforcement
│   ├── analytics.test.js       Query execution, saved queries, exports
│   ├── finance.test.js         Payments, fees, commission, settlement
│   ├── refunds.test.js         Issue/approve/execute lifecycle, audit trail
│   ├── experiments.test.js     Create, version, deterministic assignment
│   ├── reviews.test.js         Create, duplicate, hide/restore, decision log
│   └── health.test.js          Health, checkpoints, recovery events
│
├── database/                   SQL migrations (001–014, applied on startup)
├── backend/                    Node.js + Fastify REST API
│   ├── Dockerfile
│   ├── src/
│   │   ├── server.js           Entry point
│   │   ├── config.js           Environment-driven config
│   │   ├── db/                 Pool, embedded PG, migration runner
│   │   ├── auth/               JWT plugin
│   │   ├── rbac/               Roles, permission middleware
│   │   ├── audit/              Append-only audit logger
│   │   ├── crypto/             AES-256-GCM encryption, OS keystore
│   │   ├── services/           All domain services (30+ modules)
│   │   └── routes/             REST endpoint modules (12 files)
│   └── dictionaries/           Sensitive-word list
│
├── frontend/                   Svelte + Vite dashboard
│   ├── Dockerfile
│   └── src/
│       ├── App.svelte          Router + login gate
│       ├── lib/                API client, shortcuts, clipboard, masking
│       └── windows/            Queue, Experiment Lab, Settlement Workbench
│
└── electron/                   Desktop shell (Windows 11)
    └── src/                    Multi-window, tray, shortcuts, keystore
```

---

## Running Tests

All tests run inside the stack started by `docker-compose up`. A dedicated
test runner container executes the full 5-tier suite against the real Postgres
container — unit, frontend, electron, API (HTTP), and E2E.

```bash
docker-compose --profile test run --rm tests
```

That single command runs `run_tests.sh`, which:

1. Runs unit tests (pure logic, no DB)
2. Runs frontend (Svelte lib + components)
3. Runs electron (window mgr, IPC, keystore, shortcuts)
4. Runs API HTTP tests against a live Fastify + Postgres stack
5. Runs E2E flows
6. Prints a PASS/FAIL summary

> Every tier runs the same way a reviewer would run it. There is no separate
> "developer" mode.

---

## Verification Guide

### 1. Start the system

```bash
docker-compose up
```

Wait for `backend  | ready in Nms` in the logs.

### 2. Verify backend health with curl

```bash
curl http://localhost:3131/health
# → {"status":"ok","uptime":N,"timestamp":"..."}
```

### 3. Authenticate (demo credentials)

```bash
# admin
TOKEN=$(curl -s -X POST http://localhost:3131/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | jq -r .token)

# analyst
A_TOKEN=$(curl -s -X POST http://localhost:3131/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"analyst","password":"analyst123"}' | jq -r .token)

# moderator
M_TOKEN=$(curl -s -X POST http://localhost:3131/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"moderator","password":"moderator123"}' | jq -r .token)

# finance
F_TOKEN=$(curl -s -X POST http://localhost:3131/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"finance","password":"finance123"}' | jq -r .token)
```

### 4. Test RBAC enforcement

```bash
# Admin can list experiments
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3131/experiments | jq .

# Analyst cannot run settlement (403)
curl -s -X POST -H "Authorization: Bearer $A_TOKEN" \
  http://localhost:3131/settlement/run | jq .error
# → "Forbidden"

# Moderator can list review appeals
curl -s -H "Authorization: Bearer $M_TOKEN" http://localhost:3131/appeals | jq .
```

### 5. Create a payment + verify ledger (as `finance`)

```bash
curl -s -X POST -H "Authorization: Bearer $F_TOKEN" \
  -H 'Content-Type: application/json' \
  http://localhost:3131/finance/payments \
  -d '{
    "externalId":"WX-001","provider":"wechat_pay","merchantId":"M1",
    "orderId":"O1","state":"full","grossAmount":1000,
    "occurredAt":"2026-04-13T12:00:00Z"
  }' | jq .
```

You should see `payment`, `discount`, and `fees` (service, platform, surcharge, sales_tax, commission at 12.5%).

### 6. Issue + execute a refund (as `finance`)

```bash
curl -s -X POST -H "Authorization: Bearer $F_TOKEN" \
  -H 'Content-Type: application/json' \
  http://localhost:3131/refunds/issue \
  -d '{"paymentId":1,"amount":100,"reason":"customer request"}' | jq .

# If status is "approved", execute it:
curl -s -X POST -H "Authorization: Bearer $F_TOKEN" \
  http://localhost:3131/refunds/1/execute | jq .
```

### 7. Verify commission rates

```bash
curl -s -H "Authorization: Bearer $F_TOKEN" \
  http://localhost:3131/finance/commission-rates | jq .
# Default 12.5% + any provider overrides
```

### 8. Web UI flow — open the frontend

Navigate to **http://localhost:3000** in a browser. Log in with
`admin` / `admin` (or any of the other demo credentials above).

Verify you can:
- See the dashboard landing page
- Open the Queue, Experiment Lab, and Settlement Workbench windows
- Log out and log back in as a different role to see changed permissions

### 9. Run the full automated test suite

```bash
docker-compose --profile test run --rm tests
# All 5 tiers (unit + frontend + electron + API + E2E) should pass.
```

---

## Roles

| Role        | Capabilities |
|-------------|-------------|
| **admin**     | Commission rules, risk rules, moderation policies, experiment versions, **admin:ops** (internal endpoints), **LAN allowlist management**, dashboard |
| **analyst**   | Build/save queries, export reports, evaluate recommendations, dashboard |
| **moderator** | Handle reports, appeals, disputes, moderate content, dashboard |
| **finance**   | Run settlement, issue refunds, export reconciliation, dashboard |

---

## Security Controls

### Admin/Internal Endpoint Protection
All `/admin/*` endpoints (health, memory, checkpoints, recovery, versions, snapshots, LAN allowlist) require the `admin:ops` permission — only the `admin` role has it. Non-admin roles receive HTTP 403.

### Approved-Machine LAN Allowlist
When `LAN_ONLY=true`, every inbound request (except `/health`) is checked against the `lan_allowlist` table. Loopback (127.0.0.1) is always allowed. Admin manages the list via `GET/POST/DELETE /admin/lan-allowlist`.

### Identity Binding
All mutation endpoints (reviews, follows, likes, comments, reports, appeals) bind the actor identity from the JWT token. Body-supplied identity fields are overridden or ignored. Tests validate that spoofing attempts fail.

### Sensitive Data Masking
Financial amounts in the Settlement Workbench UI are masked by default (last-4-digit display via `maskLast4()`). A "Show full amounts" toggle requires explicit user action.

### Desktop App Packaging
- **Dev mode**: `FRONTEND_URL` env → Vite dev server
- **Production/packaged**: Electron loads `frontend/dist/index.html` from the bundled filesystem. The `electron-builder.yml` includes `frontend/dist/`, `backend/`, and `database/` in the package.

---

## Docker-Only Runtime Contract

This project is distributed and run **exclusively via Docker Compose**. There is
no supported manual-install / `npm install` / local-Postgres workflow — those
paths are deliberately omitted so the build is reproducible on every reviewer's
machine.

The only commands a reviewer needs:

```bash
docker-compose up                 # start everything
docker-compose down               # stop everything
docker-compose up --build         # rebuild after code change
docker-compose logs -f backend    # tail backend logs
```

Everything else — dependency install, migrations, user seeding, log rotation —
happens inside containers on startup.

---

## Environment Variable Reference

| Variable             | Required | Default                                      | Description                                                    |
|----------------------|----------|----------------------------------------------|----------------------------------------------------------------|
| `JWT_SECRET`         | Yes      | —                                            | Signing key for JWTs (min 16 chars)                            |
| `MERCHANT_DB_KEY`    | Yes      | —                                            | AES-256-GCM encryption key (64 hex chars)                      |
| `PGHOST`             | No       | `127.0.0.1`                                  | Postgres host (omit to use embedded Postgres)                  |
| `PGPORT`             | No       | `54329` (embedded) / `5432` (Docker)         | Postgres port                                                  |
| `PGUSER`             | No       | `merchant_app`                               | Postgres user                                                  |
| `PGPASSWORD`         | No       | `merchant_app`                               | Postgres password                                              |
| `PGDATABASE`         | No       | `merchant_console`                           | Database name                                                  |
| `PGDATA`             | No       | `{dataRoot}/pgdata`                          | Embedded Postgres data directory                               |
| `API_HOST`           | No       | `0.0.0.0`                                    | Fastify bind address                                           |
| `API_PORT`           | No       | `3131`                                       | Fastify listen port                                            |
| `LAN_ONLY`           | No       | `false`                                      | When `true`, enforces IP allowlist on all requests except `/health` |
| `MERCHANT_DATA_DIR`  | No       | `%PROGRAMDATA%\MerchantConsole` (Win) / `~/.MerchantConsole` | Root data directory for uploads, exports, snapshots |
| `UPLOAD_DIR`         | No       | `{dataRoot}/uploads`                         | File upload destination                                        |
| `EXPORT_DIR`         | No       | `{dataRoot}/exports`                         | Data export destination                                        |
| `UPDATE_DIR`         | No       | `{dataRoot}/updates`                         | Version update artifacts                                       |

See `backend/src/config.js` for the full config module.

---

## Entry Points (Docker-only)

| Mode                 | Container / Service     | How to Run                                          |
|----------------------|-------------------------|-----------------------------------------------------|
| **Full stack**       | all services            | `docker-compose up`                                 |
| **Backend only**     | `backend`               | `docker-compose up backend`                         |
| **Database only**    | `db`                    | `docker-compose up db`                              |
| **Frontend only**    | `frontend`              | `docker-compose up frontend`                        |
| **Full test suite**  | `tests`                 | `docker-compose --profile test run --rm tests`      |
| **Backend shell**    | `backend`               | `docker-compose exec backend sh`                    |
| **DB shell (psql)**  | `db`                    | `docker-compose exec db psql -U merchant_app merchant_console` |

---

## Installer Rollback Capability

The application includes a full database-level rollback system for version updates, exposed
through both service code and admin REST endpoints.

### How It Works

1. **Pre-update snapshot** — Before a version is applied, `snapshotService.createSnapshot()`
   dumps every user table as NDJSON, records a SHA-256 schema hash, and stores the file on disk
   with a checksum.

2. **Dry-run validation** — `GET /admin/updates/:id/rollback/validate` checks whether a rollback
   is safe without modifying any state (version exists, snapshot file present, checksum matches).

3. **Atomic rollback** — `POST /admin/updates/:id/rollback` performs the full rollback inside
   a database transaction:
   - Runs down-migrations in reverse order
   - Verifies the schema hash matches the pre-update snapshot (schema-drift detection)
   - Restores data from the NDJSON snapshot (FK constraints deferred)
   - Marks the version as `rolled_back`
   - On any failure: `ROLLBACK` — no partial state

4. **Protection**:
   - Schema drift between snapshot and current DB aborts with 409 Conflict
   - Missing or corrupted snapshot files abort with 410 Gone
   - Versioning tables (`app_versions`, `schema_migrations`, `audit_log`, `users`) are never
     truncated during restore

### Rollback API Endpoints

| Method | Endpoint                                  | Purpose                         |
|--------|-------------------------------------------|---------------------------------|
| GET    | `/admin/updates/:id/rollback/validate`    | Dry-run safety check            |
| POST   | `/admin/updates/:id/rollback`             | Execute rollback                |
| GET    | `/admin/snapshots`                        | List all snapshots              |
| POST   | `/admin/snapshots`                        | Create a manual snapshot        |
| GET    | `/admin/versions`                         | List version history            |

### Desktop Installer

The Electron desktop app is packaged via `electron-builder` (see `electron-builder.yml`) as
both MSI (per-machine) and NSIS (user-selectable directory) installers for Windows x64.
The installers bundle `backend/`, `frontend/dist/`, `database/`, and `node_modules/`.

Auto-update is not currently configured (`publish: null`). Version updates are applied via
the admin API (`POST /admin/updates/import` + `POST /admin/updates/:id/apply`), and can be
rolled back using the endpoints above. Reinstalling via MSI/NSIS is also supported.

---

## Crash Recovery

The system includes automatic crash recovery that runs at every startup
(`backend/src/services/recoveryService.js`).

| Recovery Stream      | What It Does                                                                                    |
|----------------------|-------------------------------------------------------------------------------------------------|
| **Settlement**       | Resumes interrupted settlement cycles (`status='running'`). Recomputes from payments table, idempotent via `DELETE+INSERT`. |
| **Moderation Queue** | Validates checkpoint against live DB counts. Reports drift but does not auto-correct (DB is source of truth). |
| **Experiments**      | Reloads active experiment versions from DB into in-memory cache.                                |

All recovery actions are logged to `recovery_events` with a per-boot `boot_id` for forensics.
Concurrent recovery is prevented via PostgreSQL advisory lock.

### Recovery API Endpoints

| Method | Endpoint                        | Purpose                              |
|--------|---------------------------------|--------------------------------------|
| POST   | `/admin/recovery/restore`       | Trigger manual recovery              |
| GET    | `/admin/recovery/events`        | View recovery event log              |
| GET    | `/admin/checkpoints/recent`     | View recent checkpoints              |
| POST   | `/admin/checkpoints/run-now`    | Force a checkpoint cycle             |

---

## Feature Gaps & Limitations

### 1. No Automatic Desktop Updates

**Limitation**: `electron-builder.yml` sets `publish: null`. There is no built-in auto-update
mechanism (no Squirrel, no electron-updater).

**Workaround**: Version updates are managed through the admin API:
- Import a package: `POST /admin/updates/import` (multipart file upload)
- Apply it: `POST /admin/updates/:id/apply`
- Roll back if needed: `POST /admin/updates/:id/rollback`

Alternatively, reinstall via the MSI/NSIS installer.

**Manual verification**: Confirm `publish: null` at `electron-builder.yml:48`. Verify the
import/apply/rollback endpoints exist at `backend/src/routes/versioning.js:34-75`.

### 2. Code Signing Disabled by Default

**Limitation**: The signing configuration in `electron-builder.yml:29-31` is commented out.
Unsigned installers will trigger Windows SmartScreen warnings.

**Plan**: Set `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables in CI to enable signing.

**Manual verification**: Check `electron-builder.yml:29-31` for the commented signing config.

### 3. No Down-Migration SQL in Baseline Migrations

**Limitation**: The 16 baseline migrations in `database/` are forward-only `.sql` files.
The rollback system's `schema_migrations.down_sql` column is populated only by migrations
applied through the versioning/update system (`POST /admin/updates/:id/apply`), not by the
initial baseline schema.

**Implication**: Rollback is only supported for versions applied through the update API, not
for the initial database schema setup.

**Manual verification**: `docker-compose logs backend | grep migration` to confirm all 16 files apply.
Check that `schema_migrations` is empty (baseline migrations are tracked in `applied_migrations`
instead). See `backend/src/db/migrate.js:33-50`.

### 4. Embedded PostgreSQL — Development/Desktop Only

**Limitation**: The `embedded-postgres` package (`v18.2.0-beta.16`) is intended for desktop
(Electron) and development use. It is not suitable for production server deployments.

**Plan**: For server/production deployments, always provide `PGHOST` to connect to an external
PostgreSQL instance. The embedded Postgres is only started when `PGHOST` is not set.

**Manual verification**: See `backend/src/config.js:21` — when `PGHOST` is set, embedded
Postgres is skipped. Confirm with `backend/src/db/embedded.js`.

---

## Static Evidence — Advanced Feature Code References

### RBAC (Role-Based Access Control)

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| Permission catalogue              | `backend/src/rbac/roles.js`              | 4–30    |
| Role-to-permission mapping        | `backend/src/rbac/roles.js`              | 32–75   |
| `hasPermission()` function        | `backend/src/rbac/roles.js`              | 77–79   |
| `requirePermission()` middleware  | `backend/src/rbac/middleware.js`         | 6–33    |
| Audit log on every permission check | `backend/src/rbac/middleware.js`       | 10–31   |
| Unit tests (role-permission matrix)| `unit_tests/rbac.test.js`               | all     |
| API tests (cross-role enforcement)| `API_tests/rbac.test.js`                 | all     |
| Admin security tests              | `API_tests/admin_security.test.js`       | all     |

### Vault & Encryption

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| AES-256-GCM encrypt/decrypt       | `backend/src/crypto/encryption.js`       | all     |
| Financial token store              | `backend/src/services/vaultService.js`   | all     |
| Vault routes (store/list/reveal)   | `backend/src/routes/vault.js`            | 1–62    |
| Object-level auth (admin bypass)   | `backend/src/routes/vault.js`            | 46–55   |
| Vault boundary tests               | `API_tests/vault_boundaries.test.js`     | all     |
| Encryption unit tests (IV, AAD, key rotation) | `unit_tests/encryption.test.js` | all     |

### Installer Rollback

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| Snapshot creation (NDJSON dump)    | `backend/src/services/snapshotService.js`| 62–101  |
| Snapshot checksum validation       | `backend/src/services/snapshotService.js`| 104–113 |
| Schema-hash computation            | `backend/src/services/snapshotService.js`| 34–42   |
| Transactional restore              | `backend/src/services/snapshotService.js`| 117–153 |
| Rollback dry-run validation        | `backend/src/services/rollbackService.js`| 43–67   |
| Atomic rollback (transaction)      | `backend/src/services/rollbackService.js`| 69–137  |
| Schema-drift detection             | `backend/src/services/rollbackService.js`| 96–111  |
| Rollback REST endpoints            | `backend/src/routes/versioning.js`       | 59–75   |
| Snapshot REST endpoints            | `backend/src/routes/versioning.js`       | 77–92   |
| Snapshot DB schema                 | `database/011_snapshots.sql`             | all     |

### Crash Recovery

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| Recovery orchestrator              | `backend/src/services/recoveryService.js`| 253–279 |
| Settlement idempotent resume       | `backend/src/services/recoveryService.js`| 70–121  |
| Moderation queue drift detection   | `backend/src/services/recoveryService.js`| 175–209 |
| Experiment cache reload            | `backend/src/services/recoveryService.js`| 215–249 |
| Advisory lock (concurrency guard)  | `backend/src/services/recoveryService.js`| 33–42   |
| Boot ID stamping                   | `backend/src/services/recoveryService.js`| 25      |
| Recovery events DB schema          | `database/012_recovery.sql`              | all     |
| Startup invocation                 | `backend/src/server.js`                  | 112     |
| Recovery admin endpoints           | `backend/src/routes/admin.js`            | 29–38   |
| Crash recovery API tests           | `API_tests/crash_recovery.test.js`       | all     |

### Checkpoints & Integrity

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| Checkpoint service                 | `backend/src/services/checkpointService.js` | all  |
| SHA-256 integrity verification     | `backend/src/services/checkpointIntegrity.js` | all |
| Checkpoint integrity unit tests    | `unit_tests/checkpointIntegrity.test.js` | all     |
| Reliability DB schema              | `database/010_reliability.sql`           | all     |

### Database Migrations

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| Migration runner (transactional)   | `backend/src/db/migrate.js`              | 24–51   |
| Idempotency tracking              | `backend/src/db/migrate.js`              | 10–22   |
| 16 migration files                 | `database/001_rbac.sql` through `database/016_order_lines.sql` | — |

### Identity Binding & Security

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| Identity binding tests             | `API_tests/identity_binding.test.js`     | all     |
| Cross-user access denial tests     | `API_tests/cross_user_access.test.js`    | all     |
| LAN allowlist service              | `backend/src/services/lanAllowlistService.js` | all |
| LAN allowlist enforcement hook     | `backend/src/server.js`                  | 61–70   |
| LAN admin endpoints                | `backend/src/routes/admin.js`            | 56–74   |
| LAN allowlist DB schema            | `database/015_lan_allowlist.sql`         | all     |

### Startup Performance

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| Startup timer (monotonic)          | `backend/src/services/startupTimer.js`   | all     |
| Phase markers in server startup    | `backend/src/server.js`                  | 85–120  |
| Startup timer unit tests           | `unit_tests/startupTimer.test.js`        | all     |

### Desktop App (Electron)

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| Main process entry                 | `electron/src/main.js`                   | 1–102   |
| Backend child-process launcher     | `electron/src/backendLauncher.js`        | 1–41    |
| Per-boot JWT secret generation     | `electron/src/backendLauncher.js`        | 13–14   |
| Multi-window manager               | `electron/src/windowManager.js`          | all     |
| Background jobs (IPC)              | `electron/src/backgroundJobs.js`         | all     |
| OS keystore integration            | `electron/src/keystore.js`               | all     |
| Keyboard shortcuts                 | `electron/src/shortcuts.js`              | all     |
| Electron Builder config            | `electron-builder.yml`                   | 1–57    |

### Financial Services

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| Fee calculator                     | `backend/src/services/feeCalculator.js`  | all     |
| Payment service                    | `backend/src/services/paymentService.js` | all     |
| Settlement service                 | `backend/src/services/settlementService.js` | all  |
| Refund service                     | `backend/src/services/refundService.js`  | all     |
| Finance routes                     | `backend/src/routes/finance.js`          | all     |
| Refund routes                      | `backend/src/routes/refunds.js`          | all     |
| Finance unit tests                 | `unit_tests/finance.test.js`             | all     |
| Finance API tests                  | `API_tests/finance.test.js`              | all     |
| Refund API tests                   | `API_tests/refunds.test.js`              | all     |
| Settlement timing tests            | `API_tests/settlement_timing.test.js`    | all     |

### Anti-Spam & Content Moderation

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| Spam scoring + duplicate detection | `backend/src/services/spamService.js`    | all     |
| Sensitive word filter              | `backend/src/services/sensitiveWordFilter.js` | all |
| Moderation service                 | `backend/src/services/moderationService.js` | all  |
| Spam unit tests                    | `unit_tests/spamService.test.js`         | all     |
| Anti-spam API tests                | `API_tests/antispam.test.js`             | all     |

### Export System

| What                              | File                                     | Lines   |
|-----------------------------------|------------------------------------------|---------|
| Export format (CSV)                | `backend/src/services/exportFormat.js`   | all     |
| Export service                     | `backend/src/services/exportService.js`  | all     |
| Export validation                  | `backend/src/services/exportValidation.js` | all   |
| 200k row limit enforcement         | `unit_tests/exportRowLimit.test.js`      | all     |
| Export validation unit tests       | `unit_tests/exportValidation.test.js`    | all     |
| Export service unit tests          | `unit_tests/exportService.test.js`       | all     |

---

## Offline Compliance

- **No external API calls** — all services run locally inside Docker or Electron.
- **Embedded PostgreSQL** — desktop app embeds Postgres; Docker uses a local container.
- **No CDN or remote assets** — the frontend is built and served statically.
