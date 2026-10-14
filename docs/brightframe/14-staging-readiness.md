# Staging-readiness plan

Production stays untouched throughout. Nothing here merges, migrates production, deploys to production or connects brightframekids.com. Each step lists what proves it passed. Stop at the first failure.

## 0. What is ready on the branch
- **Code:** the app on `feature/brightframe`, and every suite passing locally (see "Results" below).
- **Migrations, none of them applied anywhere:**
  - 0018 child scope
  - 0019 PIN attempts
  - 0020 watch sessions + `watched_sec`
  - 0021 per-child requests
  - 0022 more-time requests
  - 0023 one-night bedtime extensions and bedtime asks
- **Final migration order:** 0018 → 0019 → 0020 → 0021 → 0022 → 0023, all before the build that uses them. Rollback order is the reverse, and only as part of the coordinated rollback below.
- **Rollbacks:** each migration has one in `supabase/rollbacks/`. The 0018 and 0021 rollbacks never widen access and report what they couldn't carry back.

## 1. Migration rehearsal at production size (local, no Supabase)
1. `scripts/staging-db-check.sh --scale`.
   - **What it does:** builds a pre-0018 database with synthetic, production-sized data, applies 0018 → 0023 in order (timed), checks nothing is lost, rolls back 0023 → 0018, and checks no child gained access (family-wide sources and restrictions byte-identical; per-child allows restored only where every child had them).
   - **Size:** `BF_SCALE_FAMILIES=8000` gives roughly 18k children, 1.8M viewing rows and 180k permission rows. Measured times are under "Results".
2. With a data-only production dump (read-only `pg_dump`; keep it local and delete it after): `scripts/staging-db-check.sh prod-data.sql`.
   - **What it does:** runs preflight, applies 0018 → 0023 with timings, then the report, the held-for-review list, the watch-events audit, and the rollback comparison.
   - **Pass:** the rollback restores the whitelist exactly. `legacy_grants` is the expected size. No migration needs more than a short maintenance window.
3. Version-1 reviews: run `scripts/staging/v1-reviews.sql` against the dump to size the re-review job. It's read-only. (They are valid at the gate today; see step 3.)
4. **Coordinated rollback rehearsal:** `test/rollback-rehearsal.test.ts`, which runs in the script. It migrates, makes post-release permission changes, rolls back 0023 → 0018, and checks the rollback never widens access. Repeat it once on the production dump before release (step 10.3).

**Decide here:** if 0018 takes long at real size, schedule a short maintenance window. 0018 rewrites `whitelist` and backfills profile links; the others are additive.

## 2. Supabase staging project and an isolated Vercel preview
**Step-by-step:** `18-staging-runbook.md` (separate Vercel project, the `apply.sh` guarded database steps, the isolation check, and the two-build rollback rehearsal). Synthetic data only, unless you separately approve a production copy.

1. Create a **new** Supabase project, "brightframe-staging". Never point the preview at production.
2. Load a copy of production data, or the synthetic set. Apply 0001 → 0017 (if starting empty), then **0018 → 0023** in order.
3. Create a Vercel preview for `feature/brightframe` with environment variables scoped to **Preview** only:
   - Supabase staging URL and keys
   - `GEMINI_API_KEY` (with a low `DAILY_REVIEW_BUDGET_USD`)
   - `YOUTUBE_API_KEY`
   - staging VAPID keys
   - `CRON_SECRET`
   - `ADMIN_EMAILS`
   - no Stripe live keys (leave billing blank, or Stripe test keys)

   Secrets go into Vercel's env settings only, never into git or chat.
4. Protect the preview with Vercel deployment protection. No custom domain.
5. Disable the preview's crons, or point them at staging only, so they never touch production.

**Pass:**
- The preview loads.
- `/parent` requires sign-in.
- The kid screen pairs with a code.
- The Supabase logs show the staging project only.

## 3. Old version-1 AI reviews and legacy permissions
1. In staging, open Review. Old approvals that 0018 couldn't attribute appear as "Old approval record" with the candidate children. Resolve a few: Allow for one child, and Don't allow.
2. **Version-1 reviews: what the code actually does.** `reviewEligibility()` never looks at `reviewer.version`. A version-1 card is eligible whenever it has:
   - a real (non-sample) model
   - a complete, well-formed finding for every concern category
   - confidence of at least the minimum

   So a clean version-1 card **does** let a library video play, and its findings hold videos back exactly like version 2. It is *not* shown as "Couldn't be sure" because of its version. Regression tests: `test/v1-review-policy.test.ts`.

   The risk (`06-before-production.md` §1) is that a version-1 card may have recorded an unassessed category as "absent". The plan is to re-review them, library videos first, not to block them by version. Check on staging:
   - pick a version-1 card with a library video: it plays for a child whose rules it fits
   - one with a blocked tag at intensity 2 is held back
   - a low-confidence one says "Couldn't be sure"
3. Run the re-review job on a small batch, within budget. Statuses update in Library.

**Pass:**
- No child gains access to anything that was family-wide-held before.
- Library counts match Home.
- Version-1 cards behave as described, not as "held".

## 4. Real YouTube search, review and playback
1. **Search** on TV, tablet and phone with the real API (safe search strict, embeddable only). Check the states: Ready, Check it (Open), Ask a grown-up (Ask first), Waiting, Not this time, Not this one.
2. **Open mode:** Check it runs a real review in the background; the card changes to Ready or Needs a grown-up.
3. **Allowance:**
   - Exhaust the daily automatic-check allowance (set it to 2). In Open the child then gets "Sent to a grown-up" instead of a dead end.
   - In Ask first, asking still works with the allowance exhausted.
4. **Playback through the real IFrame API:** autoplay, the "Press OK to play" fallback, controls, ±10 s, auto-advance, and no YouTube end screen.

## 5. Requests, approvals, push and more time
1. **Push:** subscribe a parent phone to push on staging.
2. **Video requests:**
   - The child asks; the push arrives.
   - Review shows it.
   - Allow for the child: Home shows "A grown-up said yes!".
   - Decline: Search shows "Not this time".
   - Two children asking for the same video get separate requests and separate notifications.
3. **Bedtime extension:**
   - Set a bedtime 2 minutes ahead and play: "N minutes until bedtime" appears, and playback stops at bedtime.
   - At bedtime the child asks to stay up; the parent sees the actual cutoffs ("10:23 PM tonight") and approves one. The child's screens come back with "Staying up until …".
   - A second ask that night is refused.
   - Cancel from parent Home: the player stops within a minute, or at once on wake.
   - Change the recurring bedtime: tonight's authorized cutoff stays.
   - With the daily minutes also used up, the Review card says an extension alone won't restore playback.
   - Put a TV to sleep past the cutoff: on wake it stops at once.
4. **More time (daily limit):**
   - **Push path:** set a 5-minute limit, watch past it, then ask. The push arrives and Review shows the ask. +15 restores playback on every screen within about 15 s.
   - **Without push:** unsubscribe and repeat. The ask still appears in Review.
   - **Cross-device:** ask from the TV, then from a tablet as the same child. There's one request, and both screens say Waiting.
   - **Decline:** both screens say "A grown-up said not today"; the child can't ask again that day.
   - **Expiry:** a pending ask from yesterday doesn't appear today.
4. **Settings:** extra time granted directly from Settings also answers today's pending ask.

## 6. PIN lockout, device assignment, session authorization
1. **Shared TV:**
   - Wrong PINs up to the limit: "Too many tries. Wait N min." This is the 0019 atomic lockout. Run several parallel attempts from two screens too.
   - The right PIN after the cooldown works.
2. **Personal device** (assigned to one child):
   - Who's watching says "This is Maya's screen".
   - Switching is refused server-side, even when forced.
3. **Revoke** a device mid-session: the next request goes back to pairing.
4. **Parent session expiry:** `/parent` redirects to sign-in. Kid screens keep working with their device cookie.

## 7. Watch sessions, limits, bedtime and time zones
1. Play to the end, press Next, press Back, close the app mid-video, pause a minute, seek ahead. Then in `watch_events`:
   - one start row and one end row per session
   - the right outcome: finished only if 70% or more was actually played
   - `watched_sec` equals the time actually played, while `ended_at_sec` is the playhead
2. Run `scripts/staging/watch-events-audit.sql` before and after.
3. **Daily limit:** with 30 minutes, a 20-minute video finished once leaves about 10 minutes. Seeking ahead doesn't use minutes, and rewatching does.
4. **Bedtime:** set a bedtime 5 minutes ahead. At bedtime, the kid pages show "Time to rest" with no ask. Extra minutes don't lift it, by design.
5. **Time zone:** set the family zone to one where it's near midnight. "Today", bonus minutes and the more-time day all roll over at local midnight, and bedtime at 4 am.

## 8. Physical Samsung TV (Tizen wrapper pointed at the preview URL)
Work through the Samsung checklist in `06-before-production.md` with the real remote:
- **Home:** rows, focus start, Return to exit.
- **Search:** the on-screen keyboard, results, asking, focus restore after the player.
- **Player:**
  - first-key reveal; OK pauses while the controls are hidden; ◀ ▶ between controls; Return leaves
  - media keys, if the wrapper registers them
  - auto-advance, the skip lockout
  - an allow or restriction changing at the next advance
- **Who's watching and PIN:** arrows to OK, number keys, the lockout.
- **Time up:** the daily-limit ask and the bedtime screen.
- **App closure:** quit the Tizen app mid-video; a "left" row with `watched_sec` arrives (the beacon).
- **Readability:** the 10-foot view at 3 m, overscan margins, and the focused apricot buttons legible (ivory ring, dark text).

## 9. Security and production-launch checklist
- [ ] **Secrets:** only in Vercel or Supabase environment settings. `git grep` the branch for keys before merging; rotate anything that ever appeared in chat or logs.
- [ ] **RLS:** every table with family data has row-level security, and owner-only `select` policies, including the new `time_requests`. Writes go through the server with the secret key only.
- [ ] **Server checks:** every kid action re-resolves the child server-side from the device or profile cookie (`resolveViewer`). Playback is authorized by `authorize()` on the page and in `nextVideo`.
- [ ] **New endpoints:** `/api/watch/end` (the beacon) is same-origin only and records "left" only, for the screen's own child. The cron endpoints require `CRON_SECRET`. The Stripe webhook verifies its signature.
- [ ] **Cookies:** httpOnly, SameSite=Lax, Secure on HTTPS.
- [ ] **Abuse caps:**
  - the PIN lockout (0019)
  - one pending video request per child per video, plus a cap of 25 unanswered requests per child
  - one pending more-time ask per child per day
  - the daily automatic-review allowance and the global review budget
- [ ] **Push:** a failure never changes what's stored. Dead subscriptions are removed.
- [ ] **Dependencies:** `npm audit`, with no criticals.
- [ ] **Production release order** (each step only after explicit approval):
  1. production backup (point-in-time recovery enabled; note the restore point)
  2. apply 0018 → 0023 (in the maintenance window if step 1 says so)
  3. deploy the build
  4. smoke test (sign in, pair, play, ask, extend bedtime)
  5. connect brightframekids.com last

## 10. Coordinated production rollback (rehearse before release)

**Why it needs coordinating.** The previous production build isn't compatible with the new permission schema:
- It writes family-wide approvals with no child. After 0018 those are rejected (`whitelist_child_kinds`).
- It reads the whitelist ignoring `profile_id`. With the new schema in place, every allow made for one child would apply to the whole family. That **widens** access for siblings.
- Its request flow assumes one pending request per family per video (pre-0021).

So the old build must never run against the new schema. A rollback is app + schema together, with permission writes paused in between.

**Procedure.**
1. **Pause permission writes** on the current build: set `BF_PERMISSION_WRITES_PAUSED=1` in the production environment and redeploy (same build). While paused, every write that can change what a child may watch is refused (`src/lib/maintenance.ts`; the guarded store in `src/lib/db/resolve.ts`):
   - approvals, Never / Keep hidden, channel and video changes, old-record decisions, reviews and parent flags
   - viewing mode, content filters, daily minutes, bedtime, extra minutes, the PIN, the family's time zone
   - creating, editing or deleting a child
   - device assignment, switching a shared screen to another child, pairing a new screen (revoking a screen still works: it only restricts)
   - video requests, more-time and bedtime asks and answers, bedtime extensions and their cancellation
   - parents see a banner; children who ask are told to ask a grown-up in person
   - watching and viewing records continue
   - `test/maintenance.test.ts` attempts each of these while paused and checks that the child's effective permissions (what plays, mode, filters, minutes, bedtime, extra minutes, PIN, children, time state) are identical afterwards.
2. **Snapshot:** take a database backup / note the restore point. Export the current permissions (`select * from whitelist`, `legacy_grants`, `bedtime_extensions`) for reference.
3. **Maintenance window, in order.** Fail closed: the new build against the old schema errors (nothing plays), while the old build against the new schema would widen access. So the schema goes first.
   1. Run the rollbacks: 0023 → 0022 → 0021 → 0020 → 0019 → 0018. From here the current build's kid and parent pages fail until step ii, and nothing plays. Expect a few minutes.
   2. Deploy the previous build at once.
   3. Remove `BF_PERMISSION_WRITES_PAUSED` (the old build doesn't read it). Smoke-test: sign in, pair, play.
4. **What the rollbacks do with changes made since release** (never widening access):
   - **0018:** the previous build applies every row to every child, so a row is restored only if it grants nothing a child couldn't watch immediately before the rollback:
     - Family-wide channels and videos still in place come back.
     - A per-child allow (approval, auto-clearance, library video) comes back family-wide **only if every child in the family has it**. Otherwise it is dropped and listed in `rollback_0018_report` for a parent to redo by hand. This covers old approvals attributed to one child, allows created since release, and allows removed from one child.
     - Old approvals still awaiting a decision (`legacy_grants`, which grant nobody) are not restored, and are listed in the report.
     - Pre-release allows that no child has any more (removed, undone, dismissed) are not restored, and are listed.
     - Every restriction comes back family-wide: pre-release ones, and Never / Keep hidden set since for any child (stricter for siblings, never looser).
     - In a one-child family, everything comes back exactly.
     - Tested on effective permissions, every child × every video, before and after: `test/rollback-rehearsal.test.ts` (Maya-only old approval, held approval, approval dismissed after release, approval removed from one child, one- and two-child families, family-wide restrictions), and at scale in `test/migration-scale.test.ts` (no child gains a video or channel; restrictions unchanged).
   - **0021:** where two children had the same video pending, the earliest request is kept and the others are listed in `rollback_0021_report`.
   - **0022 / 0023:** asks for more time, bedtime asks and tonight's extensions are dropped. Children fall back to their scheduled bedtime and daily minutes, which is stricter.
   - **0020:** `session_id` and `watched_sec` are dropped. Viewing rows stay and are counted by the old rules.
5. **Afterwards:**
   - Check that `rollback_0018_report` and `rollback_0021_report` contain what you expect, and tell affected parents which approvals to redo.
   - Drop the report tables once handled.
6. **Rehearsed by:** `test/rollback-rehearsal.test.ts` (in `scripts/staging-db-check.sh`), the scale rehearsal (0023 → 0018 at 8,000 families), and `test/maintenance.test.ts` (the pause).
   - Before release, also run the whole procedure on the staging project, with the old build deployed to a second preview.

## Results (this round, local)

**Production-sized rehearsal** (synthetic, real Postgres 16, `scripts/staging-db-check.sh --scale`):

| Families | Children | Viewing rows | Permission rows | 0018 | 0019 | 0020 | 0021 | 0022 | 0023 | Rollback never widens |
|---|---|---|---|---|---|---|---|---|---|---|
| 2,000 | ~3,600 | ~360k | ~46k | 1.0 s | <0.1 s | 0.3 s | <0.1 s | <0.1 s | (not run) | Yes |
| 8,000 | ~14,400 | ~1.44M | ~184k | 5.6 s | <0.1 s | 1.4 s | <0.1 s | <0.1 s | <0.1 s | Yes (0023 → 0018) |
| 20,000 | ~36,000 | ~3.6M | ~460k | 11.4 s | <0.1 s | 3.0 s | <0.1 s | <0.1 s | (not run) | Yes |

**Found and fixed by the rehearsal:** 0018's attribution looked up every old approval's request and check history with no index on `(family_id, video_id)`.
- At 8,000 families it took **4.6 minutes**, inside one transaction holding the whitelist.
- 0018 now creates `watch_requests (family_id, video_id)`, `kid_checks (family_id, video_id)` and `profiles (family_id)` indexes first. They're also useful afterwards, and the rollback drops them.
- The same run now takes 4 seconds, and time grows roughly linearly with size.

**Still to rehearse:** a real production dump (step 1.2). Synthetic data can't show real skew, such as one family with 50,000 rows.
