# Corrections to the `ce14f16` review: checkpoint

Branch `feature/brightframe`. Production is untouched: no merge, migration, deploy or domain. No Supabase or Vercel resources have been created (I have no access to them). The staging setup is in `18-staging-runbook.md`.

## 1. Rollback can no longer widen playback (critical)
**The rule.** The previous build applies every whitelist row to every child, so `0018_child_scope.down.sql` restores a row only if it grants no child anything they couldn't watch immediately before the rollback:
- **Per-child allows** (approvals, clearances, library videos) come back family-wide only if every child in the family has them. Otherwise they're dropped and written to `rollback_0018_report` for manual restoration. This covers:
  - old approvals attributed to one child
  - allows created since release
  - allows removed from one child
- **Unresolved old approvals** (`legacy_grants`, which grant nobody) are not restored, and are reported.
- **Pre-release allows no child still has** (removed, undone, dismissed after release) are not restored, and are reported.
- **Every restriction comes back family-wide.** That includes pre-release ones and per-child Never / Keep hidden set since release (stricter for siblings).
- **One-child families** come back exactly.

**Tests.** They evaluate effective permissions (every child × every video) by the gate's order, before and after the rollback, and assert `after ⊆ before`:
- **`test/rollback-rehearsal.test.ts`:**
  - Maya-only old approval, and a held approval granting nobody
  - approval dismissed after migration, and approval removed from one child
  - an approval both children have (restored)
  - one-child and two-child families
  - family-wide block and Keep hidden, and a per-child Never
  - removed channel, and a per-child library video
  - duplicate pending requests, and the report
- **`migration-0018`, `staging-migration` and the 8,000-family scale run:** the same invariant in SQL. No restored allow lacks full coverage, and restrictions are unchanged.

## 2. The permission-write pause is complete (high)
I audited every write that can change what a child may watch. While `BF_PERMISSION_WRITES_PAUSED=1`, all of these are refused:
- viewing mode, content filters, daily minutes, bedtime and extra minutes
- the PIN and the family time zone
- creating, editing and deleting a child
- device assignment, switching a shared screen's child, and pairing a new screen
- approvals, Never / Keep hidden, sources, old-record decisions, reviews and flags
- video requests, more-time and bedtime asks and answers, and bedtime extensions and their cancellation

The guards are in the store (`src/lib/db/resolve.ts`) and in `src/lib/family.ts`. Revoking a screen stays allowed, because it only restricts.

`test/maintenance.test.ts` attempts each of these while paused. It asserts each is refused, and that the child's effective permissions are byte-identical afterwards: what plays, mode, filters, minutes, bedtime, bonus, PIN, children and time state.

## 3. Bedtime and minutes grants are atomic
- **Postgres** (0023, server-only `SECURITY DEFINER` functions):
  - `approve_bedtime_request` and `approve_minutes_request` lock the ask, create the grant and mark the ask approved in one transaction.
  - `grant_bedtime_extension` and `grant_minutes` (direct grants) answer the child's pending ask in the same transaction.
  - A failure leaves the ask pending, so nothing is reported as granted without a grant.
  - All four lock in one order (ask → child → extension), so racing calls wait instead of deadlocking.
  - The rollback drops them.
- **Local store:** each operation is a single write.
- **Tests:**
  - **`test/time-grants-db.test.ts`, PGlite:**
    - approve creates the grant together with the answer
    - a retry returns `gone`
    - a failing insert leaves the ask pending
    - an ask from another night returns `expired`
    - a direct grant answers the ask
    - only `service_role` can execute
  - **`test/time-grants-db.test.ts`, real Postgres:** ten parallel approvals give exactly one `done` and one extension. Twelve interleaved approvals and direct grants give no errors or deadlocks and one extension. The same holds for minutes.
  - **`test/bedtime-server.test.ts`:** retries, concurrent approvals and direct grants on the local store.

## 4. UX fixes
- **TV bedtime badge:**
  - opaque dark green with white text (18:1)
  - apricot ring, larger text
  - drawn above the controls overlay; it used to sit under the controls' dark gradient
  - The walkthrough now asserts it is opaque, ≥ 7:1 contrast, ≥ 28 px and topmost while the controls show.
- **Home's summary uses tonight's effective times.** It reads "Done by 8:00 pm tonight (usually 7:30 pm)" and "Up to 60 minutes today (usually 45)", matching the Tonight card (`test/when-sentence.test.ts`).
- **Deterministic clocks:**
  - Server tests inject a fixed instant.
  - `serverNow()` (`src/lib/clock.ts`) honours `BF_FAKE_NOW` in local mode only; it is ignored whenever Supabase is configured.
  - `kid-screens.sh` starts every server at 8:00 pm on 13 Oct 2026 in Los Angeles.
  - The fixtures use fixed bedtimes: 7:50 pm, and 8:03 pm for "soon".
  - Time-dependent pages get the same browser clock.
  - The suite no longer depends on when it runs.
  - The runner now waits up to 60 s for each server and reports a server that didn't start, instead of printing nothing.

## Test results
| Suite | Result |
|---|---|
| `tsc --noEmit`, `eslint .`, `next build` | Clean |
| Vitest | 397 passed, 16 skipped (the real-Postgres tests, which run in the next row) |
| `staging-db-check.sh --scale` (Postgres 16, 8,000 families) | 66 + 5 passed. 0018 4.4 s, 0020 1.5 s, 0023 <0.1 s; rollback 0023 → 0018 2.6 s, never widening |
| Gating walkthrough | 40 / 40 |
| `kid-home.sh` | 26 / 26 |
| `kid-screens.sh` | 166 / 166: Search 38, Ask first 6, Player 35, Who 17, Time up 7, more time 12 + 12, bedtime 15 + 9 + 10 + 5 |
| Staging DB simulation (`apply.sh`, local Postgres 16) | schema → seed → preflight → migrate → snapshot → rollback → check → migrate again. No child gained access; seven narrowed pairs reported; a planted widening row fails the check; every refusal guard works |

## Limitations
- Nothing has run against a real Supabase project or a real Vercel deployment yet. That is the next step, and it needs your actions.
- The isolation check's network calls were tested against a mocked Supabase, in both passing and failing states, not real projects.
- Playwright's fake page clock perturbs the scripted YouTube player's timing. So the browser clock is installed only for the time-dependent scenarios; the server clock is fixed for all of them.
