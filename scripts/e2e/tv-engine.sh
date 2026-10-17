#!/usr/bin/env bash
# The kid experience on Chromium 108 (the Samsung S85D's original engine), local mode, production build.
#   CHROME108=/path/to/chromium-108 PUPPETEER_MODULE=/path/to/puppeteer-core@19 scripts/e2e/tv-engine.sh [out-dir]
# Chromium 108 and puppeteer-core 19 both come from npm (works where browser download hosts are blocked):
#   npm i @sparticuz/chromium@108 puppeteer-core@19.4.1
#   node -e 'const f=require("fs"),z=require("zlib"),p="node_modules/@sparticuz/chromium/bin/";f.writeFileSync("chromium-108",z.brotliDecompressSync(f.readFileSync(p+"chromium.br")));f.chmodSync("chromium-108",0o755)'
# Needs a local-mode build (npx next build with no Supabase variables).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT"
: "${CHROME108:?set CHROME108 to a Chromium 108 binary}"
export BF_FAKE_NOW="${BF_FAKE_NOW:-2026-10-13T20:00:00-07:00}"
fail=0
for FIXTURE in ${FIXTURES:-main bedtime-final}; do
  WORK="$(mktemp -d)"
  node scripts/e2e/kid-fixtures.cjs "$FIXTURE" "$WORK/db.json"
  NEXT_PUBLIC_SUPABASE_URL= SIFT_LOCAL_DB="$WORK/db.json" setsid npx next start -p 3318 > "$WORK/server.log" 2>&1 &
  S=$!
  for _ in $(seq 1 120); do curl -s -o /dev/null http://localhost:3318/watch/who && break; sleep 0.5; done
  echo "▶ tv-engine.cjs ($FIXTURE)"
  FIXTURE="$FIXTURE" BASE=http://localhost:3318 OUT="$OUT" node scripts/e2e/tv-engine.cjs || fail=1
  kill -- -"$S" 2>/dev/null || kill "$S" 2>/dev/null || true
done
echo "screenshots: $OUT"
exit $fail
