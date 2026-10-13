# Child-scoped permissions — what changed

Implements the approved gating plan (`01-gating-audit.md`) with decisions A–E. Branch `feature/brightframe`. Nothing is merged or deployed.

## The rule, and where it lives

`src/lib/gate.ts` → `authorize(video, childSettings)` is the only playback decision. It's pure (no I/O). These all call it:
- the kid home, search, and play page
- the player's every advance and skip (`nextVideo`)
- the open-mode check (`settleCheck`)
- every parent count and queue

It runs these checks in order:

1. **No resolved child, or flags computed for a different child** → deny (fails closed).
2. **"Never" — blocked for this child, or blocked family-wide** → deny.
3. **"Allow for <child>"** (an `override` naming this child) → allow. This is the only path that plays an unreviewed or filtered video.
4. **"Keep hidden" for this child (or a family-wide one from before 0018)** → deny. It's a standing decision: it holds even if the video is later re-reviewed more favorably or the child's filters are relaxed, until a parent chooses "Allow for <child>" (which replaces it) or "Stop keeping hidden".
5. **No eligible review** → deny. Eligible means a real model (not `sample`) and a card where every field the gate relies on is valid (`cardProblems()`):
   - age minimum and maximum are integers 0–18, with min ≤ max
   - confidence is a finite number from 0 to 1, and ≥ 0.7
   - format is a known format, so a blocked format can't slip through as an unknown string
   - there is exactly one well-formed finding for every concern tag in the taxonomy (a known tag, a boolean `present`, an integer intensity 0–3), so a tag that wasn't assessed can't read as "absent"

   Anything else is reported as "Review was incomplete".
6. **The child's rules** → deny with reasons:
   - age minimum above the child (the age maximum is informational only)
   - blocked formats
   - blocked tags, where the AI found intensity ≥ 2 (intensity decides, even if `present` disagrees) or enough parents flagged it as missed

   Peer "over-called" votes never clear an AI flag.
7. **Is there a source for this child?**
   - The video is in the library (approved channel or "Add & review") → allow.
   - The child is in Open mode → allow.
   - Locked or Ask First with no source → deny.

Consequences:
- **Channel approvals are content sources, not authorization.** A missing, sample, failed or low-confidence review never authorizes playback.
- **An open-mode clearance (`auto`) is only a record.** Authorization comes from the child's *current* mode, so it disappears when the child moves to Locked or Ask First.

## Decisions A–E as implemented

- **A — "Add & review" vs "Allow for [child]".**
  - Single-video adds from search, a pasted link, or the card page are labeled **Add & review**. They add a family-wide `video` source and start the AI review. They don't authorize playback.
  - **Allow for [child]** is a separate per-child button on the card page, in the review queue, and on request cards.
  - If the video has no eligible review (none yet, low confidence, or incomplete), the parent must confirm a disclosure: "This video hasn't been reviewed yet… the AI review and your filters won't apply. Only <child> gets access."
    - This is enforced in `allowForChild()` on the server (`NeedsUnreviewedConfirm`), so it applies on every path: the video page, the Review queue, kid requests (on the dashboard and on Review), and old-record re-assignment.
    - All four paths show the same confirm card (`src/app/parent/unreviewed-confirm.tsx`).
    - A reviewed video that the child's filters hide needs no extra confirmation; the review itself was the check.
- **B — Same eligibility everywhere.** The review and rule checks apply to every path, including channel videos. The age maximum is informational.
- **C — Channels stay family-wide.** Channels and added videos are family-wide sources (`profile_id` null). The schema already allows per-child rows (`whitelist.profile_id`), and the gate honours them.
- **D — Profile switching is server-side.**
  - A device's child is stored on the device row: `assigned_profile_id` for a personal device, or `active_profile_id` for a shared screen. A device never reads the child from a cookie.
  - On a shared multi-child screen, picking or switching needs the family PIN. PINs are now scrypt-hashed.
  - A screen locks for 5 minutes after 5 tries. This is enforced atomically in the database by `claim_pin_attempt()` (migration 0019):
    - each attempt is counted up front, under the device row lock, before the PIN is checked
    - a correct PIN then clears the count
    - parallel guesses can't get past the limit; 25 simultaneous attempts on a real Postgres server let exactly 5 through
    - if the database call fails, the switch is refused ("Couldn't check the PIN right now")
  - The old default PIN `1234` doesn't count as set, whether stored plain or hashed, so shared screens stay closed until a parent sets a PIN. Parents can't choose `1234` as a new PIN.
  - Personal devices can't switch. Parents assign devices under **Devices**.
  - With no child resolved, every kid page redirects to **Who's watching?**, and `authorize` denies.
  - The remote works throughout. The PIN pad takes remote arrows and OK, the number keys, or touch.
- **E — Legacy permissions.** See migration below. Ambiguous approvals grant nothing. They go to an "Old approvals to review" list on the **Review** page.
  - Each record says what it was: "a parent approved this video", or "an automatic Open-mode search check cleared it. No parent approved it."
  - **Allow for <child>** always creates an explicit approval for that child that works in every viewing mode, including for old automatic clearances. It isn't re-created as an inert Open-mode record.
  - **Don't allow** grants nothing and keeps the record as history.

Kid-side indicators are also child-scoped now: pending requests, running checks, and "A grown-up said yes!".

## Migration `0018_child_scope.sql` (Supabase) and its local twin

**Run order matters.** Apply 0018 and then 0019 (`0019_pin_attempts.sql`, the atomic PIN functions) immediately before deploying this branch. The current `main` code doesn't send a child, so after 0018 the database rejects `main`'s approvals. And this branch's code can't run without 0018's columns.

**What it does:**

1. Snapshots `whitelist` to `whitelist_pre_0018`.
2. Adds `whitelist.id` (the new primary key) and `whitelist.profile_id`, plus:
   - a composite FK `(profile_id, family_id) → profiles(id, family_id)`, so a child row can only name a child of the same family
   - a `UNIQUE NULLS NOT DISTINCT (family_id, kind, target_id, profile_id)` key, so family-wide and per-child rows each dedupe and upsert correctly
3. **Backfill — attribution only when reliable:**
   - The family has exactly one child → that child.
   - `override`: every approved request for that video came from one (non-null) child → that child.
   - `auto`: every passing check for that video came from one (non-null) child → that child.
   - Anything else → `legacy_grants`, with candidate children listed. It grants nothing until a parent decides.
   - `block` and `dismissed` stay family-wide (restrictive). `channel` and `video` stay family-wide.
4. Adds a check constraint: `override` and `auto` rows must name a child.
5. Adds composite child→family FKs on `watch_events`, `kid_checks`, `watch_requests`, `kid_days` and `devices`. History rows use `ON DELETE SET NULL (profile_id)`; grants and check-ins cascade.
6. Adds the device columns: `assigned_profile_id`, `active_profile_id`, `pin_failures`, `pin_locked_until`.
7. Fills any missing child age from the family's legacy age, so the age gate can't silently fail open.

**Rollback:** run `supabase/rollbacks/0019_pin_attempts.down.sql` first. Then `supabase/rollbacks/0018_child_scope.down.sql` restores the whitelist exactly from the snapshot and drops everything 0018 added. Approvals and assignments made after 0018 are discarded, as the file header says.

**Local store:** `migrateLocalToChildScope()` in `src/lib/db/local.ts` runs once, keyed on `schema: 18`. It applies the same rules, except that it has no request or check history: legacy approvals are attributed only in one-child families. It also keeps `whitelistPre0018` so the change can be undone.

**Requires Postgres 15+** (`NULLS NOT DISTINCT`, and `SET NULL (column)`). Supabase projects are 15 or newer. Confirm yours under Settings → Infrastructure before running.

## Tests

`npm test` runs Vitest: 169 tests, plus 9 that need a real Postgres server (below).

| file | covers |
|---|---|
| `src/lib/gate.test.ts` | review eligibility, including about 30 kinds of malformed cards, each run through `authorize()`; channel ≠ approval in all three modes; mode semantics; tags, formats, age min/max; peer flags restrict but never clear; child-scoped overrides; blocks; **"Keep hidden" holds after a better re-review and after relaxed filters**, in every mode, only for that child, and is replaced by Allow; open clearance doesn't persist across modes; fail-closed cases; grant scoping; advance re-derivation |
| `test/grants.test.ts` | grant writes against the real local store: child scoping; cross-family refused; **unreviewed allow refused without confirmation on every path (video page, queue, request, old record), with nothing written**; **old open-mode clearance → explicit approval that plays in Locked, Ask First and Open**; "Don't allow" keeps history; Keep hidden through the store; lifting a family-wide Keep hidden; local migration twin |
| `test/pin-and-pick.test.ts` | PIN hashing; legacy plain PINs; `1234` (plain or hashed) isn't set and can't be chosen; device → child resolution |
| `test/pin-lockout-db.test.ts` | `claim_pin_attempt` in PGlite: the limit, burst, success reset, expiry, revoked devices, no browser execute rights, rollback. **With a real server: 25 parallel connections → exactly 5 attempts allowed**, over repeated rounds |
| `test/migration-0018.test.ts` | every real migration in PGlite (Postgres 17): backfill, held records, constraints, uniqueness, cascade, rollback |
| `test/staging-migration.test.ts` | **staging rehearsal on a real server**: 60 representative families (1–3 kids, over 1,000 grants with request and check history) → 0018 + 0019. Checks every old approval against an independent re-implementation of the attribution rule (attributed to exactly the right child or held, never both, never lost); other rows untouched; same-family integrity; upsert; PIN functions; exact rollback |
| `test/single-gate.test.ts` | guard rail: kid surfaces use only the one gate |

**Real-Postgres rehearsal:** `npm run test:staging` (`scripts/staging-db-check.sh`).
- It starts a throwaway local Postgres, runs the real-server tests above, and stops it. It never touches Supabase.
- `npm run test:staging -- prod-data.sql` also rehearses on a **data-only dump of production**, in this order:
  1. Build the schema as of 0017 and load the dump.
  2. Run `scripts/staging/preflight.sql`. It flags data 0018 would reject, such as a child linked to another family.
  3. Apply 0018 + 0019 and print `scripts/staging/report.sql`: what was attributed and what was held.
  4. Show the first held records.
  5. Roll back both and check the whitelist matches the original exactly.
- How to make the dump is in the script header. It contains family data: keep it local and delete it afterwards.

**Browser walkthrough:** `scripts/e2e/gating-walkthrough.sh` (local mode, headless Chromium, 29 checks, with screenshots):
- two kids with nobody picked → "Who's watching?"; `1234` refused on the TV and as a new PIN
- picking with the remote only: arrows to the tile, OK, number keys, arrows to the pad's OK; a wrong PIN, then the right one
- each child's home shows only what passes for them; TV arrows move between the menu and the tiles
- Keep hidden holds after the filters are relaxed, and "Stop keeping hidden" lifts it
- an unreviewed Allow on the video page and from the Review page (old record) shows the disclosure and grants nothing until confirmed
- switching to Leo needs the PIN again; Maya's approvals don't carry over, and opening one by URL returns 404

**Other checks:** `tsc --noEmit` passes, `eslint` is clean, and `next build` passes.

## Before production — staging checklist

1. `npm run test:staging -- prod-data.sql` against a fresh dump. All preflight "must be 0" rows should be 0. Read the held-records list; that's what parents will see under "Old approvals to review".
2. A Supabase **staging** project (or branch) restored from the same data, with 0018 + 0019 applied, and this branch deployed to a Vercel preview pointed at it. Check by hand:
   - **Profile selection / PIN on the TV:** pick with arrows and OK and with number keys; try a wrong PIN; make 5 wrong tries and confirm the lockout and its countdown; let the lock expire; pair a second device and check it has its own counter; make it a personal device and check it can't switch.
   - **Child-specific approval:** allow a video for one child and confirm the other doesn't get it; undo the allow.
   - **Kid requests:** Supabase-only, so not covered by the local walkthrough. From the TV, ask for a video. Approve it from the dashboard and from Review, including an unreviewed one (the disclosure appears). Check it plays only for the child who asked. Then try a request with no child recorded.
   - **Old approvals:** resolve a few held records each way.
   - **TV navigation on the Samsung:** Who's watching, the PIN pad, home rows, the player's advance and skip.
3. Only then apply 0018 + 0019 to production, immediately before deploying.

## Limitations and notes

- **Not run against your Supabase database.** The migration ran in PGlite (Postgres 17) against every migration in the repo, not your live data. Read the backfill output (`select * from legacy_grants`) after running it.
- **Local dev mode keeps the active child in a cookie.** There's no device table locally, and it's still only set by the PIN-checked action. Supabase mode stores it on the device row.
- **Restrictions apply at the next advance, not mid-video.** A restriction added while a video is playing takes effect at the next advance, skip or page load; the current video isn't cut off.
- **A parent previewing the kid screen picks a child without a PIN**, because they're signed in. That choice lives in the parent's cookie.
- **Low-confidence cards aren't automatically re-reviewed.** They show up in the parent's review queue as "Review wasn't confident enough."
- **`profiles.hide_unreviewed` is kept but ignored**, and its checkbox is removed.
- **Vitest is installed with `--legacy-peer-deps`.** npm 10's resolver crashes on Vitest's optional browser-runner peers. That flag affects only the dev-only test runner; no runtime dependency changed. PGlite is dev-only too.
- **The demo family's PIN is now `2580`**, because `1234` no longer counts as a PIN. The demo page shows it.
- **Local dev mode has no shared-screen lockout** (there's no device table). Supabase mode enforces it in the database.
- **Kid requests and the database lockout weren't exercised in a browser**, because both need Supabase. Requests are covered by unit tests of `approveRequest` and the confirm flow; the lockout by real-Postgres tests. Both are on the staging checklist above.

## Follow-up fixes (round 3)

**The AI reviewer no longer fills in findings.**
- `normalizeReview()` in `src/lib/reviewer.ts` accepts a response only if the model assessed every concern tag exactly once.
- A missing tag, a duplicated tag, an unknown tag, a bad value, an unparseable response or an empty response throws `IncompleteReviewError`, and nothing is stored. The video stays "Being reviewed" and can't play.
- An open-mode kid check that hits an incomplete review asks a parent instead.
- The response schema now asks the model for exactly N findings.
- Tests: `test/reviewer-normalize.test.ts`.

**Existing reviews made before this fix:**
- Cards from reviewer version "1" (before this change) may contain "absent" findings the code filled in.
- Those can't be told apart from findings the model actually gave.
- They stay valid, so nothing disappears from kids' screens overnight.
- New cards are version "2".
- `npm run review -- --upgrade-v1 --max 50` re-reviews version-1 cards, oldest first. It counts against the daily budget and keeps the old card if the re-review fails.
- Recommendation: run it in batches after deploying.
- Known gap: the tokens spent on a rejected (incomplete) response aren't counted by the cost meter, because the meter sums stored cards.

**Family-wide blocks (pre-0018):**
- `allowForChild()` now refuses with `FamilyBlockError` instead of writing an approval that would change nothing.
- The video page says the video is blocked for every child, and offers two actions.
  - **Block each child separately:**
    - writes a block for each current child before removing the family-wide one, so nobody is unblocked at any point
    - each child can then be allowed on their own
    - children added later aren't covered
  - **Unblock for everyone:**
    - first shows what each child would then be able to watch, and asks for confirmation
    - leaves each child's own blocks in place
- Tests are in `test/grants.test.ts`.

## Before production: two policies to confirm

**Version-1 AI reviews (those that may contain filled-in "absent" findings)**
- **What they are:** cards made before reviewer version 2. If the model left a concern category out, the old code wrote it as "not present". Afterwards, there's no way to tell those apart from real "not present" findings.
- **How they're treated now:**
  - They count as complete reviews. The gate's checks (all categories present, values in range, confidence ≥ 0.7) all pass, because the filling-in made them look complete.
  - Videos they cleared keep playing.
  - The UI doesn't single them out.
- **The risk:** a category the model never assessed reads as "not found". The only categories affected are those the model skipped; a skipped category was most often one that wasn't present.
- **How to find out the scale:**
  1. `npm run review -- --upgrade-v1 --dry` lists how many version-1 cards there are.
  2. `--upgrade-v1 --max N` re-reviews them oldest first, within the daily budget. If a re-review fails, the version-1 card stays.
- **Options (product decision):**
  - **(a)** Re-review all version-1 cards in nightly batches after deploy. Recommended.
  - **(b)** Also treat version-1 cards as "Awaiting review" until re-reviewed. Stricter, but every currently playable video stops playing until it's re-reviewed.
  - **(c)** Leave them as they are.

  This branch implements (a)'s tooling but doesn't run it.

**Family-wide (pre-0018) blocks and children added later**
- A family-wide block applies to every child, **including children added later**, until a parent changes it. No child's "Allow" can get past it, and the video page says so.
- **"Block each child separately"** turns it into one block per *current* child. A child added afterwards is **not** blocked by it; the video page says this before you choose it.
- **"Unblock for everyone"** removes it after showing what each current child would then be able to watch. A child added later gets the normal rules.
- **Choice to confirm:**
  - Keep these semantics (recommended): family-wide = everyone, now and later; per child = the children you chose.
  - Or have new children inherit their siblings' blocks, which would be new functionality.
