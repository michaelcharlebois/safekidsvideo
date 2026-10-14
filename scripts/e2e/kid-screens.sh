#!/usr/bin/env bash
# Kid Search, Requests, Player, Who's watching and Time up (local mode, production build, Playwright).
#   PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome scripts/e2e/kid-screens.sh [out-dir] [only-script]
# Each line is: <fixture scenario> <script>. Every run gets a fresh copy of the fixture database.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT"; ONLY="${2:-}"
run() { # fixture script port
  local WORK; WORK="$(mktemp -d)"
  node scripts/e2e/kid-fixtures.cjs "$1" "$WORK/db.json"
  SIFT_LOCAL_DB="$WORK/db.json" setsid npx next start -p "$3" > "$WORK/server.log" 2>&1 &
  local SERVER=$!
  for _ in $(seq 1 40); do curl -s -o /dev/null "http://localhost:$3/watch/who" && break; sleep 0.5; done
  local rc=0
  FIXTURE="$1" DB="$WORK/db.json" BASE="http://localhost:$3" OUT="$OUT" node "scripts/e2e/$2" || rc=$?
  kill -- -"$SERVER" 2>/dev/null || kill "$SERVER" 2>/dev/null || true
  return $rc
}
fail=0
while read -r fixture script; do
  [ -z "$fixture" ] && continue
  if [ -n "$ONLY" ] && [ "$ONLY" != "$script" ]; then continue; fi
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
LIST
echo "screenshots: $OUT"
exit $fail
