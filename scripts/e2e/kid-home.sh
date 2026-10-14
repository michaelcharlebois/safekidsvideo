#!/usr/bin/env bash
# Kid Home check: TV interface from a Samsung Tizen user agent, D-pad walk (arrows, OK, Return 10009),
# tablet and phone layouts, screenshots. Needs a production build and Playwright.
#   PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome scripts/e2e/kid-home.sh [out-dir]
set -euo pipefail
cd "$(dirname "$0")/../.."
WORK="$(mktemp -d)"; PORT="${PORT:-3314}"; OUT="${1:-$WORK}"
cp scripts/e2e/ux-fixture-db.json "$WORK/db.json"
SIFT_LOCAL_DB="$WORK/db.json" setsid npx next start -p "$PORT" > "$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill -- -$SERVER 2>/dev/null || kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -s -o /dev/null "http://localhost:$PORT/watch/who" && break; sleep 0.5; done
BASE="http://localhost:$PORT" OUT="$OUT" node scripts/e2e/kid-home.cjs
echo "screenshots: $OUT"
