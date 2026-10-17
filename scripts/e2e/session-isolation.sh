#!/usr/bin/env bash
# Parent / kid-screen session isolation, end to end, in account (Supabase) mode with no network: builds the app
# against scripts/e2e/fake-supabase.cjs, starts both, and runs session-isolation.cjs in Playwright.
#   PLAYWRIGHT_MODULE=… CHROME_PATH=… scripts/e2e/session-isolation.sh [out-dir]
# NOTE: this replaces .next with an account-mode build. Rebuild (npx next build) before the local-mode suites.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT"
FPORT=54400; PORT=3317; WORK="$(mktemp -d)"
cat > "$WORK/seed.json" <<'JSON'
{ "families": [{ "id": "f0000000-0000-4000-8000-000000000001", "owner_user_id": "u0000000-0000-4000-8000-000000000001", "pin_hash": "2580", "plan": "free", "onboarded_at": "2026-10-01T00:00:00Z", "timezone": "America/Los_Angeles", "flag_threshold": 3, "kid_age": 6 }],
  "profiles": [{ "id": "p0000000-0000-4000-8000-0000000000a1", "family_id": "f0000000-0000-4000-8000-000000000001", "name": "Maya", "age": 6, "sort": 0, "mode": "locked" },
               { "id": "p0000000-0000-4000-8000-0000000000a2", "family_id": "f0000000-0000-4000-8000-000000000001", "name": "Leo", "age": 4, "sort": 1, "mode": "locked" }] }
JSON
export NEXT_PUBLIC_SUPABASE_URL="http://localhost:$FPORT" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_fake" SUPABASE_SECRET_KEY="sb_secret_fake"
node scripts/e2e/fake-supabase.cjs "$FPORT" "$WORK/seed.json" > "$WORK/fake.log" 2>&1 &
FAKE_PID=$!
cleanup() { kill "$FAKE_PID" 2>/dev/null || true; [ -n "${SERVER:-}" ] && { kill -- -"$SERVER" 2>/dev/null || kill "$SERVER" 2>/dev/null || true; }; }
trap cleanup EXIT
echo "▶ building in account mode (against the fake)"
npx next build > "$WORK/build.log" 2>&1 || { tail -30 "$WORK/build.log"; exit 1; }
setsid npx next start -p "$PORT" > "$WORK/server.log" 2>&1 &
SERVER=$!
for _ in $(seq 1 120); do curl -s -o /dev/null "http://localhost:$PORT/login" && break; sleep 0.5; done
echo "▶ session-isolation.cjs"
rc=0; BASE="http://localhost:$PORT" FAKE="http://127.0.0.1:$FPORT" OUT="$OUT" node scripts/e2e/session-isolation.cjs || rc=$?
[ "$rc" != 0 ] && { echo "server log: $WORK/server.log"; tail -20 "$WORK/server.log"; }
echo "(.next is now an account-mode build: run npx next build before the local-mode suites)"
exit $rc
