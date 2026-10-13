#!/usr/bin/env bash
# Runs migrations + SQL test suite against a throwaway local PostgreSQL database.
# Usage: supabase/tests/run_local.sh   (needs a reachable postgres superuser, e.g. PGUSER=postgres)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-stakeout_test}
PSQL="psql -X -q -v ON_ERROR_STOP=1"
${PSQL} -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
${PSQL} -d "${DB}" -f tests/00_supabase_stub.sql
for f in migrations/*.sql; do echo "→ applying ${f}"; ${PSQL} -d "${DB}" -f "${f}"; done
echo "→ running tests"
${PSQL} -d "${DB}" -f tests/10_rls_tests.sql
