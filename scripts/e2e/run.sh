#!/usr/bin/env bash
# Runs the app's real data layer (src/lib/api.ts) against local Postgres + PostgREST with the real
# migrations. Needs: a PostgreSQL superuser reachable as $PGSUPER (default: postgres via `su`),
# the PostgREST binary at $POSTGREST (https://github.com/PostgREST/postgrest/releases).
# The gateway shim mimics Supabase's /rest/v1 prefix and a minimal /auth/v1/user.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
POSTGREST=${POSTGREST:-postgrest}
PSQL=${PSQL:-"su postgres -c"}
run_sql() { $PSQL "psql -X -q -v ON_ERROR_STOP=1 $*"; }

pkill postgrest 2>/dev/null || true; pkill -f e2e/gateway.mjs 2>/dev/null || true
run_sql "-d postgres -c 'drop database if exists stakeout_e2e' -c 'create database stakeout_e2e'" 2>/dev/null
FILES=$(for f in "$ROOT"/supabase/tests/00_supabase_stub.sql "$ROOT"/supabase/migrations/*.sql; do printf -- '-f %s ' "$f"; done)
run_sql "-d stakeout_e2e $FILES" 2>/dev/null
run_sql "-d stakeout_e2e" <<'SQL' 2>/dev/null
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login password 'pw'; end if; end $$;
grant anon, authenticated to authenticator;
insert into auth.users (id,email,raw_user_meta_data) values
 ('aaaaaaaa-0000-0000-0000-000000000001','alice@x.io','{"username":"alice","display_name":"Alice"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002','bob@x.io','{"username":"bob","display_name":"Bob"}'),
 ('cccccccc-0000-0000-0000-000000000003','carol@x.io','{"username":"carol","display_name":"Carol"}');
SQL
(setsid nohup "$POSTGREST" "$ROOT/scripts/e2e/postgrest.conf" >/tmp/pgrst.log 2>&1 </dev/null &)
(setsid nohup node "$ROOT/scripts/e2e/gateway.mjs" >/tmp/gw.log 2>&1 </dev/null &)
sleep 3
cd "$ROOT"
E2E_URL=http://localhost:3001 E2E_JWT_SECRET=e2e-secret-e2e-secret-e2e-secret-1234 \
VITE_SUPABASE_URL=http://localhost:3001 VITE_SUPABASE_ANON_KEY=anon-public-key \
  npx vitest run src/lib/api.e2e.test.ts
pkill postgrest 2>/dev/null || true; pkill -f e2e/gateway.mjs 2>/dev/null || true
