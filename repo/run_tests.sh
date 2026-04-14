#!/usr/bin/env bash
set -euo pipefail

# ─── Merchant Console — Test Runner ──────────────────────────────────────────
# Runs ALL unit + API tests. Idempotent — safe to re-run any number of times.
#
# Prerequisites (auto-handled when run from docker compose):
#   - Node.js 20+
#   - PostgreSQL reachable at TEST_PGHOST:TEST_PGPORT (defaults: localhost:5432)
#
# Usage:
#   ./run_tests.sh                         # from repo root
#   TEST_PGHOST=db TEST_PGPORT=5432 ./run_tests.sh   # inside Docker network

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Dependency install ────────────────────────────────────────────────────
echo "=== Installing backend dependencies ==="
cd backend
npm install --omit=dev 2>/dev/null || npm install
cd "$SCRIPT_DIR"

# ─── Environment for API tests ─────────────────────────────────────────────
export PGHOST="${TEST_PGHOST:-localhost}"
export PGPORT="${TEST_PGPORT:-5432}"
export PGUSER="${PGUSER:-merchant_app}"
export PGPASSWORD="${PGPASSWORD:-merchant_app}"
export PGDATABASE="${PGDATABASE:-merchant_console}"
export JWT_SECRET="${JWT_SECRET:-test-secret-minimum-16-chars}"
export MERCHANT_DB_KEY="${MERCHANT_DB_KEY:-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789}"
export API_PORT=0  # let tests use inject(), no port needed

UNIT_PASS=0
UNIT_FAIL=0
API_PASS=0
API_FAIL=0

# ─── Unit tests (pure logic — no DB) ──────────────────────────────────────
echo ""
echo "================================================================"
echo "  UNIT TESTS"
echo "================================================================"

UNIT_FILES=$(find unit_tests -name '*.test.js' | sort)
if [ -n "$UNIT_FILES" ]; then
  if node --test $UNIT_FILES 2>&1 | tee /dev/stderr | tail -5 | grep -q "^# fail 0"; then
    UNIT_PASS=1
    echo "  ✓ ALL UNIT TESTS PASSED"
  else
    UNIT_FAIL=1
    echo "  ✗ SOME UNIT TESTS FAILED"
  fi
else
  echo "  (no unit test files found)"
fi

# ─── API tests (integration — needs Postgres) ─────────────────────────────
echo ""
echo "================================================================"
echo "  API TESTS"
echo "================================================================"

# Wait for Postgres to be ready (up to 30s)
echo "  Waiting for Postgres at $PGHOST:$PGPORT ..."
for i in $(seq 1 30); do
  if node -e "
    const { Pool } = require('pg');
    const p = new Pool({ host:'$PGHOST', port:$PGPORT, user:'$PGUSER', password:'$PGPASSWORD', database:'$PGDATABASE' });
    p.query('SELECT 1').then(() => { p.end(); process.exit(0); }).catch(() => { p.end(); process.exit(1); });
  " 2>/dev/null; then
    echo "  Postgres ready."
    break
  fi
  sleep 1
done

# Run migrations before API tests
echo "  Running migrations ..."
node backend/src/db/migrate.js 2>&1 || true

API_FILES=$(find API_tests -name '*.test.js' | sort)
if [ -n "$API_FILES" ]; then
  if node --test $API_FILES 2>&1 | tee /dev/stderr | tail -5 | grep -q "^# fail 0"; then
    API_PASS=1
    echo "  ✓ ALL API TESTS PASSED"
  else
    API_FAIL=1
    echo "  ✗ SOME API TESTS FAILED"
  fi
else
  echo "  (no API test files found)"
fi

# ─── Summary ───────────────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo "  SUMMARY"
echo "================================================================"
echo "  Unit tests:  $([ $UNIT_PASS -eq 1 ] && echo 'PASS' || echo 'FAIL')"
echo "  API  tests:  $([ $API_PASS -eq 1 ] && echo 'PASS' || echo 'FAIL')"
echo "================================================================"

if [ $UNIT_FAIL -ne 0 ] || [ $API_FAIL -ne 0 ]; then
  exit 1
fi

echo ""
echo "All tests passed."
exit 0
