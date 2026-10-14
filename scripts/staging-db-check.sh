#!/usr/bin/env bash
# Staging rehearsal for migrations 0018 to 0023 on a throwaway local Postgres server. Never touches
# Supabase. Needs the Postgres server binaries (initdb, pg_ctl) — e.g. `apt install postgresql`.
#
#   scripts/staging-db-check.sh                 # representative synthetic data + real-concurrency tests
#   scripts/staging-db-check.sh --scale         # ALSO a production-sized synthetic rehearsal, timed
#                                               #   (BF_SCALE_FAMILIES=20000 for a larger run; default 2000)
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
npx vitest run test/staging-migration.test.ts test/pin-lockout-db.test.ts test/migration-0018.test.ts test/watch-sessions-db.test.ts test/child-requests-db.test.ts test/time-requests-db.test.ts test/bedtime-extensions-db.test.ts test/time-grants-db.test.ts test/rollback-rehearsal.test.ts

if [ "${1:-}" = "--scale" ]; then
  echo "▶ Production-sized rehearsal (${BF_SCALE_FAMILIES:-2000} families): 0018 → 0023, timed, then rolled back"
  BF_SCALE=1 npx vitest run test/migration-scale.test.ts --reporter=verbose --disable-console-intercept
  shift
fi

if [ "${1:-}" != "" ]; then
  DUMP="$1"
  [ -f "$DUMP" ] || { echo "No such dump: $DUMP"; exit 1; }
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
  echo "▶ Watch-events audit (before 0020)"; "${PSQL[@]}" -P pager=off -f scripts/staging/watch-events-audit.sql || true
  for m in 0018_child_scope 0019_pin_attempts 0020_watch_sessions 0021_child_requests 0022_time_requests 0023_bedtime_extensions; do
    t0=$(date +%s%N); "${PSQL[@]}" -f "supabase/migrations/$m.sql" >/dev/null; echo "  applied $m in $(( ($(date +%s%N) - t0) / 1000000 )) ms"
  done
  echo "▶ Report"; "${PSQL[@]}" -P pager=off -f scripts/staging/report.sql
  echo "▶ Held for review (first 25)"; "${PSQL[@]}" -P pager=off -c "select family_id, kind, target_id, array_length(candidate_profile_ids,1) as candidates from legacy_grants order by family_id limit 25"
  echo "▶ Rolling back (0023 → 0018) and checking that nobody's access widened"
  "${PSQL[@]}" -c "create table _pre_rb as select family_id, kind, target_id, profile_id from whitelist; create table _kids_rb as select family_id, count(*)::int n from profiles group by family_id" >/dev/null
  for m in 0023_bedtime_extensions 0022_time_requests 0021_child_requests 0020_watch_sessions; do "${PSQL[@]}" -f "supabase/rollbacks/$m.down.sql" >/dev/null; done
  "${PSQL[@]}" -f supabase/rollbacks/0019_pin_attempts.down.sql >/dev/null
  "${PSQL[@]}" -f supabase/rollbacks/0018_child_scope.down.sql >/dev/null
  WIDER=$("${PSQL[@]}" -At -c "select count(*) from whitelist w join _kids_rb k on k.family_id = w.family_id where w.kind in ('channel','video','override','auto') and not exists (select 1 from _pre_rb p where p.family_id = w.family_id and p.kind = w.kind and p.target_id = w.target_id and p.profile_id is null) and (select count(distinct p.profile_id) from _pre_rb p where p.family_id = w.family_id and p.kind = w.kind and p.target_id = w.target_id) <> k.n")
  LOOSER=$("${PSQL[@]}" -At -c "select count(*) from _pre_rb p where p.kind in ('block','dismissed') and not exists (select 1 from whitelist w where w.family_id = p.family_id and w.kind = p.kind and w.target_id = p.target_id)")
  FAMWIDE=$("${PSQL[@]}" -At -c "select count(*) from ((select family_id, kind, target_id from _wl_before where kind in ('channel','video','block','dismissed') except select family_id, kind, target_id from whitelist) union all (select family_id, kind, target_id from whitelist where kind in ('channel','video','block','dismissed') except select family_id, kind, target_id from _wl_before)) d")
  REPORTED=$("${PSQL[@]}" -At -c "select count(*) from rollback_0018_report")
  [ "$WIDER" = "0" ] && [ "$LOOSER" = "0" ] && [ "$FAMWIDE" = "0" ] \
    && echo "✓ rollback widened nobody's access; family-wide sources and restrictions identical; $REPORTED per-child allows reported for manual restore" \
    || { echo "✗ rollback check failed: widened=$WIDER loosened=$LOOSER family-wide-diff=$FAMWIDE"; exit 1; }
fi
echo "✓ staging rehearsal passed"
