#!/usr/bin/env bash
set -euo pipefail

# ─── Merchant Console — Full Test Runner ────────────────────────────────────
# Runs every tier of the test suite (unit, frontend, electron, API, E2E) and
# produces a consolidated PASS/FAIL summary. Idempotent — safe to re-run.
#
# Test tiers:
#   1. unit_tests/        Pure-logic backend tests (no DB)
#   2. frontend_tests/    Svelte components + lib/*.js (no DB, no network)
#   3. electron_tests/    Window manager, IPC, keystore, background jobs
#   4. API_tests/         Integration tests (needs Postgres)
#   5. e2e_tests/         Full-stack user flows (needs Postgres; auto-skips otherwise)
#
# Optional: COVERAGE=1 ./run_tests.sh enables Node's built-in coverage report.
#
# Usage:
#   ./run_tests.sh                                       # from repo root
#   TEST_PGHOST=db TEST_PGPORT=5432 ./run_tests.sh       # inside Docker network
#   COVERAGE=1 ./run_tests.sh                            # with coverage

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Dependency preflight (NO install here) ─────────────────────────────────
# The test runner MUST NOT perform runtime `npm install`. Dependencies are
# installed during Docker image build (see backend/Dockerfile, frontend/Dockerfile)
# or, for local invocations, by running `npm install` once before the suite.
# We just check the tree exists and fail fast with a helpful message otherwise.
if [ ! -d node_modules ]; then
  echo "ERROR: node_modules is missing." >&2
  echo "  Run:  npm ci     (or rebuild the test image: docker-compose build tests)" >&2
  exit 2
fi
if [ ! -d node_modules/fastify ] || [ ! -d node_modules/pg ]; then
  echo "ERROR: backend runtime deps (fastify, pg) are missing from node_modules." >&2
  echo "  Run:  npm ci     (the Docker image already does this at build-time)" >&2
  exit 2
fi

# ─── Environment ────────────────────────────────────────────────────────────
export PGHOST="${TEST_PGHOST:-localhost}"
export PGPORT="${TEST_PGPORT:-5432}"
export PGUSER="${PGUSER:-merchant_app}"
export PGPASSWORD="${PGPASSWORD:-merchant_app}"
export PGDATABASE="${PGDATABASE:-merchant_console}"
export JWT_SECRET="${JWT_SECRET:-test-secret-minimum-16-chars}"
export MERCHANT_DB_KEY="${MERCHANT_DB_KEY:-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789}"
export API_PORT=0

UNIT_STATUS=skip
FRONTEND_STATUS=skip
ELECTRON_STATUS=skip
API_STATUS=skip
E2E_STATUS=skip

# Coverage flags
COV_FLAGS=""
if [ "${COVERAGE:-0}" = "1" ]; then
  COV_FLAGS="--experimental-test-coverage --test-coverage-include=backend/src/**/*.js --test-coverage-include=frontend/src/**/*.js --test-coverage-include=electron/src/**/*.js --test-coverage-exclude=node_modules/** --test-coverage-exclude=*.test.js --test-coverage-exclude=**/_*.js --test-coverage-exclude=backend/src/db/embedded.js --test-coverage-exclude=backend/src/server.js"
  echo "=== COVERAGE mode enabled ==="
fi

run_tier () {
  local name="$1"
  local glob="$2"
  echo ""
  echo "================================================================"
  echo "  $name"
  echo "================================================================"
  # shellcheck disable=SC2086
  local files
  files=$(find $glob -name '*.test.js' 2>/dev/null | sort)
  if [ -z "$files" ]; then
    echo "  (no test files matched $glob)"
    return 1
  fi
  # shellcheck disable=SC2086
  # Capture full TAP output so we can search for the summary counters.
  # Coverage mode appends a report *after* the summary, so we can't rely on
  # `tail` — instead we look for any line like "# fail N" and confirm N == 0.
  local out
  out=$(node --test $COV_FLAGS $files 2>&1 || true)
  echo "$out"
  local failCount
  failCount=$(echo "$out" | grep -E "^# fail [0-9]+" | head -1 | awk '{print $3}')
  if [ -n "$failCount" ] && [ "$failCount" = "0" ]; then
    echo "  ✓ $name PASSED"
    return 0
  else
    echo "  ✗ $name FAILED (fail count: ${failCount:-unknown})"
    return 1
  fi
}

# ─── 1. Unit tests (pure logic — no DB) ─────────────────────────────────────
if run_tier "UNIT TESTS (unit_tests/)" "unit_tests"; then
  UNIT_STATUS=pass
else
  UNIT_STATUS=fail
fi

# ─── 2. Frontend tests (Svelte components + lib) ────────────────────────────
if run_tier "FRONTEND TESTS (frontend_tests/)" "frontend_tests"; then
  FRONTEND_STATUS=pass
else
  FRONTEND_STATUS=fail
fi

# ─── 3. Electron tests (window mgr, IPC, shortcuts, keystore) ───────────────
if run_tier "ELECTRON TESTS (electron_tests/)" "electron_tests"; then
  ELECTRON_STATUS=pass
else
  ELECTRON_STATUS=fail
fi

# ─── Wait for Postgres (API + E2E tiers need it) ────────────────────────────
echo ""
echo "  Probing Postgres at $PGHOST:$PGPORT ..."
PG_OK=0
for i in $(seq 1 30); do
  if node -e "
    const { Pool } = require('pg');
    const p = new Pool({ host:'$PGHOST', port:$PGPORT, user:'$PGUSER', password:'$PGPASSWORD', database:'$PGDATABASE' });
    p.query('SELECT 1').then(() => { p.end(); process.exit(0); }).catch(() => { p.end(); process.exit(1); });
  " 2>/dev/null; then
    echo "  Postgres ready."
    PG_OK=1
    break
  fi
  sleep 1
done

if [ $PG_OK -eq 1 ]; then
  echo "  Running migrations ..."
  node backend/src/db/migrate.js 2>&1 || true

  # ─── 4. API integration tests ─────────────────────────────────────────────
  if run_tier "API TESTS (API_tests/)" "API_tests"; then
    API_STATUS=pass
  else
    API_STATUS=fail
  fi

  # ─── 5. End-to-end tests (full stack) ─────────────────────────────────────
  if run_tier "E2E TESTS (e2e_tests/)" "e2e_tests"; then
    E2E_STATUS=pass
  else
    E2E_STATUS=fail
  fi
else
  echo "  Postgres not reachable — skipping API + E2E tiers."
fi

# ─── Summary ───────────────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo "  SUMMARY"
echo "================================================================"
printf "  Unit     tests: %s\n" "$UNIT_STATUS"
printf "  Frontend tests: %s\n" "$FRONTEND_STATUS"
printf "  Electron tests: %s\n" "$ELECTRON_STATUS"
printf "  API      tests: %s\n" "$API_STATUS"
printf "  E2E      tests: %s\n" "$E2E_STATUS"
echo "================================================================"

FAIL_COUNT=0
for s in "$UNIT_STATUS" "$FRONTEND_STATUS" "$ELECTRON_STATUS" "$API_STATUS" "$E2E_STATUS"; do
  if [ "$s" = "fail" ]; then FAIL_COUNT=$((FAIL_COUNT + 1)); fi
done

if [ $FAIL_COUNT -ne 0 ]; then
  echo ""
  echo "$FAIL_COUNT tier(s) FAILED."
  exit 1
fi

echo ""
echo "All test tiers passed (or were skipped cleanly)."
exit 0
