#!/usr/bin/env bash
# Staging rehearsal for migrations 0018 + 0019 on a throwaway local Postgres server. Never touches
# Supabase. Needs the Postgres server binaries (initdb, pg_ctl) — e.g. `apt install postgresql`.
#
#   scripts/staging-db-check.sh                 # representative synthetic data + real-concurrency PIN tests
#   scripts/staging-db-check.sh prod-data.sql   # ALSO rehearse on a data-only dump of production
#
# Making the dump (read-only on production; the file contains family data — keep it local, delete after):
#   pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner --no-privileges -f prod-data.sql
# (Supabase → Project Settings → Database → connection string; or `supabase db dump --data-only`.)
set -euo pipefail
cd "$(dirname "$0")/.."

BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$BIN/initdb" ] || { echo "Postgres server binaries not found (set PG_BIN)"; exit 1; }
DIR="$(mktemp -d)"; PORT="${PG_PORT:-54329}"
cleanup() { "$BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

RUNAS=()
if [ "$(id -u)" = 0 ]; then chown -R postgres "$DIR" 2>/dev/null || { useradd -r postgres && chown -R postgres "$DIR"; }; RUNAS=(runuser -u postgres --); fi
"${RUNAS[@]}" "$BIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" -w start >/dev/null
echo "▶ Postgres $("$BIN/postgres" --version | awk '{print $3}') on socket $DIR:$PORT"
export PG_TEST_URL="postgresql://postgres@localhost:$PORT/postgres?host=$DIR"

echo "▶ Real-Postgres tests (representative data rehearsal, concurrency)"
npx vitest run test/staging-migration.test.ts test/pin-lockout-db.test.ts test/migration-0018.test.ts

if [ "${1:-}" != "" ]; then
  DUMP="$1"
  export PGOPTIONS="-c client_min_messages=warning"
  PSQL=(psql -X -v ON_ERROR_STOP=1 -q "postgresql://postgres@localhost:$PORT/stage?host=$DIR")
  createdb_() { psql -X -q "$PG_TEST_URL" -c "create database stage"; }
  createdb_
  echo "▶ Building the schema as of 0017, then loading $DUMP"
  {
    cat <<'SQL'
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
SQL
    for f in supabase/migrations/00*.sql; do n=$(basename "$f"); [[ "$n" < "0018" ]] && cat "$f"; done
    # The migrations seed defaults (e.g. a starter reviewer-notes row); the dump has the real ones.
    echo "do \$\$ declare t text; begin for t in select tablename from pg_tables where schemaname='public' loop execute format('truncate %I cascade', t); end loop; end \$\$;"
  } | "${PSQL[@]}" >/dev/null
  # auth.users rows the data references (the dump is public-schema only).
  { echo "set session_replication_role = replica;"; cat "$DUMP"; } | "${PSQL[@]}" >/dev/null
  "${PSQL[@]}" -c "insert into auth.users (id) select distinct owner_user_id from families on conflict do nothing" >/dev/null
  echo "▶ Preflight (before 0018)"; "${PSQL[@]}" -P pager=off -f scripts/staging/preflight.sql
  "${PSQL[@]}" -c "create table _wl_before as select family_id, kind, target_id, created_at from whitelist" >/dev/null
  echo "▶ Applying 0018 + 0019"
  "${PSQL[@]}" -f supabase/migrations/0018_child_scope.sql >/dev/null
  "${PSQL[@]}" -f supabase/migrations/0019_pin_attempts.sql >/dev/null
  echo "▶ Report"; "${PSQL[@]}" -P pager=off -f scripts/staging/report.sql
  echo "▶ Held for review (first 25)"; "${PSQL[@]}" -P pager=off -c "select family_id, kind, target_id, array_length(candidate_profile_ids,1) as candidates from legacy_grants order by family_id limit 25"
  echo "▶ Rolling back (0019, then 0018) and comparing"
  "${PSQL[@]}" -f supabase/rollbacks/0019_pin_attempts.down.sql >/dev/null
  "${PSQL[@]}" -f supabase/rollbacks/0018_child_scope.down.sql >/dev/null
  DIFF=$("${PSQL[@]}" -At -c "select count(*) from ((table _wl_before except select family_id, kind, target_id, created_at from whitelist) union all (select family_id, kind, target_id, created_at from whitelist except table _wl_before)) d")
  [ "$DIFF" = "0" ] && echo "✓ rollback restored the whitelist exactly" || { echo "✗ rollback differs by $DIFF rows"; exit 1; }
fi
echo "✓ staging rehearsal passed"
