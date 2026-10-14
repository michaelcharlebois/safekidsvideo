#!/usr/bin/env bash
# Kid Home checks (local mode, production build, Playwright):
#   main     — TV from a Samsung Tizen user agent; D-pad walk (arrows, OK, Return 10009); single focus highlight;
#              tablet and phone layouts; screenshots
#   empty / waiting / locked — where focus starts and what the first OK does when nothing can play
#   PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome scripts/e2e/kid-home.sh [out-dir]
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT"
run() { # scenario port
  local WORK; WORK="$(mktemp -d)"
  node scripts/e2e/kid-fixtures.cjs "$1" "$WORK/db.json"
  SIFT_LOCAL_DB="$WORK/db.json" setsid npx next start -p "$2" > "$WORK/server.log" 2>&1 &
  local SERVER=$!
  for _ in $(seq 1 40); do curl -s -o /dev/null "http://localhost:$2/watch/who" && break; sleep 0.5; done
  local rc=0
  if [ "$1" = main ]; then BASE="http://localhost:$2" OUT="$OUT" node scripts/e2e/kid-home.cjs || rc=$?
  else SCENARIO="$1" BASE="http://localhost:$2" OUT="$OUT" node scripts/e2e/kid-home.cjs || rc=$?; fi
  kill -- -"$SERVER" 2>/dev/null || kill "$SERVER" 2>/dev/null || true
  return $rc
}
fail=0
for s in main empty waiting locked; do echo "▶ $s"; run "$s" 3314 || fail=1; done
echo "screenshots: $OUT"
exit $fail
