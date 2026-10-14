# Bedtime extension, rollback safety and pre-staging corrections: checkpoint

Branch `feature/brightframe`. Production untouched: no merge, migration, deploy or domain. No Supabase staging project or Vercel preview has been created.

## Commits
| Commit | What |
|---|---|
| `fab3c03` | Regression tests: version-1 reviews are judged by content, not version |
| `953bc9c` | One-night bedtime extension (migration 0023), kid statuses that aren't dead buttons |
| `f842af2` | Coordinated rollback: permission-write pause, rollbacks that never widen access, rehearsal |
| (docs) | Staging plan: final migration order, the version-1 policy, the coordinated rollback procedure; this checkpoint; screenshots |

## What changed against your list
- **Bedtime extension:** built to your four decisions and the refinements. The specification is in `13-bedtime-extension-proposal.md`, now marked approved and implemented.
- **Version-1 policy:**
  - `14-staging-readiness.md` wrongly said version-1 cards show "Couldn't be sure". Corrected: `reviewEligibility()` judges content and confidence, never the version.
  - `06-before-production.md` was already right.
  - Regression tests: `test/v1-review-policy.test.ts`.
- **Rollback:** documented as a fail-closed, coordinated procedure (`14`, section 10):
  - pause permission writes
  - roll the schema back 0023 → 0018
  - deploy the previous build
  - lift the pause

  The 0018 and 0021 rollbacks were rewritten so the result never widens what any child can watch compared with the moment of rollback, and they report what they couldn't carry back. Rehearsed in PGlite with post-release changes, and in real Postgres at 8,000 families.
- **Statuses:** after asking (more time or bedtime), the child sees a status line ("Sent! Waiting for a grown-up", "A grown-up said not tonight"). It isn't a focusable button.
- **Found while testing:** when time ran out mid-video, the player's client-side return Home kept the old kid layout, so a child could land on Home instead of the time-up screen. The player now returns with a full page load and the server decides.

## Tests
| Suite | Result |
|---|---|
| `tsc`, `eslint .`, `next build` | Clean |
| Vitest | 369 passed, 15 skipped (real-Postgres; they run in the staging script) |
| `staging-db-check.sh --scale` (real Postgres 16, 8,000 families) | 55 + 5 passed. 0018 5.6 s, 0020 1.4 s, 0023 <0.1 s; rollback 0023 → 0018 exact |
| Gating walkthrough | 40 / 40 |
| `kid-home.sh` | All passing |
| `kid-search.cjs` | 38 / 38 (see note) |
| `kid-search-askfirst.cjs` | 6 / 6 |
| `kid-player.cjs` | 35 / 35 |
| `kid-who.cjs` | 17 / 17 |
| `kid-timeup.cjs` | 7 / 7 |
| `kid-moretime.cjs` | 12 / 12 (approve) and 12 / 12 (decline) |
| `kid-bedtime.cjs` | 15 (ask) + 9 (decline) + 10 (minutes also used up) + 4 (soon) |

Note: in one full run, the Search walkthrough produced no output (its server didn't come up in time after the previous suite). Run on its own twice, it passed 38 / 38 both times.

**New focused tests:**
- **Bedtime extension:** `bedtime.test.ts`, `bedtime-extensions-db.test.ts`, `bedtime-server.test.ts`
- **Daily-limit interaction:** server tests in both directions, and the `bedtime-limit` walkthrough
- **Duplicate requests:** database, server, and a phone and TV asking at once in the walkthrough
- **Changing the recurring bedtime:** unit and server tests, and the walkthrough
- **Cancellation:** server tests, and the player stopping on its next check in the walkthrough
- **Server-side enforcement:** server tests, plus the player page refusing playback after bedtime in the walkthrough
- **Rollback safety:** `rollback-rehearsal.test.ts`, `maintenance.test.ts`

## Screenshots (`phase9/`)
- **Child's request:** `bedtime-tv-ask` (focused), `bedtime-phone-ask`, `bedtime-tv-waiting` (status, not a button), `bedtime-tv-declined`.
- **Parent's approval:** `bedtime-parent-review` (each choice shows the actual cutoff), `bedtime-parent-review-limit` (minutes also used up), `bedtime-parent-home-extended` (Tonight card with Cancel).
- **Active extension:** `bedtime-tv-extended-home`, `bedtime-phone-extended-home` ("Staying up until …").
- **Player:** `bedtime-player-tv-warning`.
- **Edge cases:** `bedtime-tv-extended-but-limit` (the daily-limit screen while extended), `bedtime-tv-after-cancel`.

## Remaining real-service and device blockers
1. **Production data dump:** run `scripts/staging-db-check.sh prod-data.sql` for real-data migration timing and skew. Repeat the coordinated rollback on it.
2. **Supabase staging and isolated preview** (only after your go-ahead). Verify on it:
   - RLS on the new tables
   - the 0019 PIN lockout
   - personal and shared devices
   - real push for video, more-time and bedtime asks
   - `watched_sec` and the close-time beacon
   - 0020–0023 behaviour
   - the pause switch
   - the full rollback, with the old build on a second preview
3. **Real YouTube:** search, review and IFrame playback, including autoplay, buffering, and the player stopping at the bedtime cutoff with real video.
4. **Physical Samsung TV:**
   - the remote and media keys
   - sleep/wake past bedtime (simulated here with a fake page clock)
   - the 60-second server check and on-wake check after a parent cancels
   - the app-exit beacon
   - 10-foot legibility of the bedtime screens
5. **Clock-dependent tests:** bedtime walkthroughs and server tests set bedtimes relative to the current Los Angeles time. Between about 04:00 and 04:30 Los Angeles time they can cross the rollover and fail spuriously.
6. **Security checklist** (`14`, section 9), including rotating any key that was ever pasted outside environment settings.
