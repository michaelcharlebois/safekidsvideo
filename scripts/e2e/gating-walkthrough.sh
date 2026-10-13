#!/usr/bin/env bash
# Browser walkthrough of child-scoped gating in local mode (no Supabase): PIN pick/switch with the
# remote, 1234 refused, Keep hidden, unreviewed-allow disclosure, old-record re-assignment, per-child
# isolation, TV arrow navigation. Needs a production build (`npx next build`) and Playwright.
#   PLAYWRIGHT_MODULE=/path/to/playwright CHROME_PATH=/path/to/chrome scripts/e2e/gating-walkthrough.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
WORK="$(mktemp -d)"; PORT="${PORT:-3311}"
cp scripts/e2e/fixture-db.json "$WORK/db.json"   # a throwaway copy; your data/db.json is untouched
SIFT_LOCAL_DB="$WORK/db.json" npx next start -p "$PORT" > "$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/watch/who" && break; sleep 0.5; done
BASE_URL="http://localhost:$PORT" OUT_DIR="$WORK" node scripts/e2e/gating-walkthrough.cjs
echo "screenshots: $WORK"
