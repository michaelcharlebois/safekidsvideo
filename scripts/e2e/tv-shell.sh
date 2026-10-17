#!/usr/bin/env bash
# The Samsung TV shell (tizen/app) on Chromium 108 against the local app. Same setup as tv-engine.sh.
#   CHROME108=… PUPPETEER_MODULE=… scripts/e2e/tv-shell.sh [out-dir]
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT"
: "${CHROME108:?set CHROME108 to a Chromium 108 binary (see tv-engine.sh)}"
WORK="$(mktemp -d)"
node scripts/e2e/kid-fixtures.cjs main "$WORK/db.json"
NEXT_PUBLIC_SUPABASE_URL= SIFT_LOCAL_DB="$WORK/db.json" setsid npx next start -p 3320 > "$WORK/server.log" 2>&1 &
S=$!
trap 'kill -- -"$S" 2>/dev/null || kill "$S" 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do curl -s -o /dev/null http://localhost:3320/api/tv/ping && break; sleep 0.5; done
BASE=http://localhost:3320 OUT="$OUT" node scripts/e2e/tv-shell.cjs
