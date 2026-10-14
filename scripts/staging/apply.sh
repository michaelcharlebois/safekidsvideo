#!/usr/bin/env bash
# Database steps for the Brightframe STAGING project, with guards against pointing at production.
# Run on your computer (needs psql 15+). Never run against production.
#
#   export STAGING_DB_URL='postgresql://postgres.<staging-ref>:<password>@<pooler-host>:5432/postgres'   # session mode, port 5432
#   export PROD_SUPABASE_URL='https://<prod-ref>.supabase.co'    # public; used only to refuse production
#   scripts/staging/apply.sh <step>
#
# Steps, in runbook order (docs/brightframe/18-staging-runbook.md):
#   schema           0001 → 0017 on an EMPTY project (refuses if any app table exists)
#   seed OWNER_TWO OWNER_ONE OWNER_THREE   synthetic families for three test sign-ins (refuses if families exist)
#   preflight        read-only checks before 0018
#   migrate          0018 → 0023, each in one transaction, timed; then the report
#   snapshot         record every child's effective permissions (rollback rehearsal, writes paused)
#   rollback         0023 → 0018, in order (asks you to type the project ref)
#   check            compare effective permissions with the snapshot: fails if any child gained access
#   status           which migrations are applied, and the rollback reports
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${STAGING_DB_URL:?set STAGING_DB_URL to the staging connection string}"
: "${PROD_SUPABASE_URL:?set PROD_SUPABASE_URL (public) so this script can refuse production}"
PROD_REF="$(echo "$PROD_SUPABASE_URL" | sed -E 's#https?://([^.]+)\..*#\1#')"
[ -n "$PROD_REF" ] || { echo "Couldn't read the production project ref from PROD_SUPABASE_URL"; exit 1; }
case "$STAGING_DB_URL" in *"$PROD_REF"*) echo "REFUSING: STAGING_DB_URL contains the production project ref ($PROD_REF)."; exit 1;; esac
PSQL=(psql -X -v ON_ERROR_STOP=1 "$STAGING_DB_URL")
q() { "${PSQL[@]}" -tA -c "$1"; }
has_col() { [ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='$1' and column_name='$2'")" = 1 ]; }
has_tbl() { [ "$(q "select count(*) from information_schema.tables where table_schema='public' and table_name='$1'")" = 1 ]; }
step="${1:-status}"; shift || true

case "$step" in
  schema)
    has_tbl families && { echo "REFUSING: this database already has app tables. 'schema' is only for a new, empty staging project."; exit 1; }
    for f in supabase/migrations/00{01..17}_*.sql; do echo "▶ $f"; "${PSQL[@]}" -q -1 -f "$f"; done
    echo "✓ schema at 0017. Next: create the three test sign-ins, then: $0 seed <owner-two> <owner-one> <owner-three>";;
  seed)
    [ $# = 3 ] || { echo "usage: $0 seed OWNER_TWO OWNER_ONE OWNER_THREE (auth user ids from Authentication → Users)"; exit 1; }
    "${PSQL[@]}" -q -v owner_two="$1" -v owner_one="$2" -v owner_three="$3" -f scripts/staging/seed-synthetic.sql;;
  preflight)
    "${PSQL[@]}" -f scripts/staging/preflight.sql;;
  migrate)
    has_col whitelist profile_id && { echo "Already past 0018 (whitelist.profile_id exists). Run '$0 status'."; exit 1; }
    for m in 0018_child_scope 0019_pin_attempts 0020_watch_sessions 0021_child_requests 0022_time_requests 0023_bedtime_extensions; do
      t0=$(date +%s%N); one=(-1); grep -qi '^begin;' "supabase/migrations/$m.sql" && one=(); "${PSQL[@]}" -q "${one[@]}" -f "supabase/migrations/$m.sql"; echo "▶ $m  $(( ($(date +%s%N) - t0) / 1000000 )) ms"
    done
    "${PSQL[@]}" -f scripts/staging/report.sql;;
  snapshot)
    has_col whitelist profile_id || { echo "Not migrated: nothing to snapshot."; exit 1; }
    "${PSQL[@]}" -v phase=before -f scripts/staging/effective-permissions.sql;;
  rollback)
    has_col whitelist profile_id || { echo "Already at the old schema."; exit 1; }
    [ "$(q "select count(*) from information_schema.tables where table_name='rehearsal_effective'")" = 1 ] || { echo "Take the snapshot first: $0 snapshot"; exit 1; }
    guess="$(echo "$STAGING_DB_URL" | sed -nE 's#.*postgres\.([a-z0-9]+)[:@].*#\1#p; s#.*db\.([a-z0-9]+)\.supabase\.co.*#\1#p' | head -1)"
    STAGING_REF="${STAGING_REF:-$guess}"
    echo "Rolling back 0023 → 0018 on staging project '${STAGING_REF:-unknown}'. Permission writes must be paused on the staging preview."
    read -r -p "Type the staging project ref to continue: " typed
    [ -n "$STAGING_REF" ] && [ "$typed" = "$STAGING_REF" ] || { echo "Doesn't match. Stopped."; exit 1; }
    for m in 0023_bedtime_extensions 0022_time_requests 0021_child_requests 0020_watch_sessions 0019_pin_attempts 0018_child_scope; do
      t0=$(date +%s%N); one=(-1); grep -qi '^begin;' "supabase/rollbacks/$m.down.sql" && one=(); "${PSQL[@]}" -q "${one[@]}" -f "supabase/rollbacks/$m.down.sql"; echo "▶ rolled back $m  $(( ($(date +%s%N) - t0) / 1000000 )) ms"
    done
    echo "Next: deploy the old build, then: $0 check";;
  check)
    "${PSQL[@]}" -v phase=after -f scripts/staging/effective-permissions.sql
    "${PSQL[@]}" -c "select kind, target_id, profile_id, note from rollback_0018_report order by family_id, kind, target_id" \
                 -c "select video_id, profile_id from rollback_0021_report";;
  status)
    for t in legacy_grants:0018 time_requests:0022 bedtime_extensions:0023; do
      has_tbl "${t%%:*}" && echo "  ${t##*:} applied (${t%%:*})" || echo "  ${t##*:} not applied"
    done
    [ "$(q "select count(*) from pg_proc where proname = 'claim_pin_attempt'")" = 1 ] && echo "  0019 applied (claim_pin_attempt)" || echo "  0019 not applied"
    has_col watch_events watched_sec && echo "  0020 applied (watched_sec)" || echo "  0020 not applied"
    [ "$(q "select count(*) from pg_indexes where indexname = 'watch_requests_pending_child_idx'")" = 1 ] && echo "  0021 applied (per-child pending requests)" || echo "  0021 not applied"
    for r in rollback_0018_report rollback_0021_report rehearsal_effective; do has_tbl "$r" && echo "  $r: $(q "select count(*) from $r") rows"; done
    echo "  families: $(q "select count(*) from families"), children: $(q "select count(*) from profiles"), push subscriptions: $(q "select count(*) from push_subscriptions")";;
  *) echo "unknown step: $step (see the header of $0)"; exit 1;;
esac
