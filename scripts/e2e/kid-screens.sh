#!/usr/bin/env bash
# Kid Search, Requests, Player, Who's watching and Time up (local mode, production build, Playwright).
#   PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome scripts/e2e/kid-screens.sh [out-dir] [only-script] [only-fixture]
# Each line is: <fixture scenario> <script>. Every run gets a fresh copy of the fixture database.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT"; ONLY="${2:-}"; ONLY_FIXTURE="${3:-}"
# A fixed test clock: 8:00 pm on Tue 13 Oct 2026 in Los Angeles (the fixture family's time zone). The server,
# the fixtures and the browsers all start from it, so bedtime, "today" and "tonight" are the same every run.
export BF_FAKE_NOW="${BF_FAKE_NOW:-2026-10-13T20:00:00-07:00}"
run() { # fixture script port
  local WORK; WORK="$(mktemp -d)"
  node scripts/e2e/kid-fixtures.cjs "$1" "$WORK/db.json"
  BF_FAKE_BOOT="$(date +%s%3N)"; export BF_FAKE_BOOT
  NEXT_PUBLIC_SUPABASE_URL= SIFT_LOCAL_DB="$WORK/db.json" setsid npx next start -p "$3" > "$WORK/server.log" 2>&1 &
  local SERVER=$!
  local up=0
  for _ in $(seq 1 120); do curl -s -o /dev/null "http://localhost:$3/watch/who" && { up=1; break; }; sleep 0.5; done
  if [ "$up" != 1 ]; then echo "FAIL  server didn't start in 60 s (log: $WORK/server.log)"; kill -- -"$SERVER" 2>/dev/null || true; return 1; fi
  local rc=0
  FIXTURE="$1" DB="$WORK/db.json" BASE="http://localhost:$3" OUT="$OUT" node "scripts/e2e/$2" || rc=$?
  [ "$rc" != 0 ] && echo "FAIL  $2 exited with $rc"
  kill -- -"$SERVER" 2>/dev/null || kill "$SERVER" 2>/dev/null || true
  return $rc
}
fail=0
while read -r fixture script; do
  [ -z "$fixture" ] && continue
  if [ -n "$ONLY" ] && [ "$ONLY" != "$script" ]; then continue; fi
  if [ -n "$ONLY_FIXTURE" ] && [ "$ONLY_FIXTURE" != "$fixture" ]; then continue; fi
  echo "▶ $script ($fixture)"; run "$fixture" "$script" 3315 || fail=1
done <<'LIST'
main kid-search.cjs
askfirst kid-search-askfirst.cjs
player kid-player.cjs
main kid-who.cjs
timeup kid-timeup.cjs
limit kid-moretime.cjs
limit-decline kid-moretime.cjs
bedtime-ask kid-bedtime.cjs
bedtime-decline kid-bedtime.cjs
bedtime-limit kid-bedtime.cjs
bedtime-soon kid-bedtime.cjs
bedtime-final kid-bedtime.cjs
LIST
echo "screenshots: $OUT"
exit $fail
