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
2. **Blocked for this child, or blocked family-wide** → deny.
3. **"Allow for <child>"** (an `override` naming this child) → allow. This is the only path that plays an unreviewed or filtered video.
4. **No eligible review** → deny. Eligible means a real model (not `sample`), well-formed, and confidence ≥ 0.7.
5. **The child's rules** → deny with reasons:
   - age minimum above the child (the age maximum is informational only)
   - blocked formats
   - blocked tags, where the AI found intensity ≥ 2 or enough parents flagged it as missed

   Peer "over-called" votes never clear an AI flag.
6. **Is there a source for this child?**
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
  - If the video isn't reviewed yet, the parent gets a confirm step: "This video hasn't been reviewed yet… the AI review and your filters won't apply."
- **B — Same eligibility everywhere.** The review and rule checks apply to every path, including channel videos. The age maximum is informational.
- **C — Channels stay family-wide.** Channels and added videos are family-wide sources (`profile_id` null). The schema already allows per-child rows (`whitelist.profile_id`), and the gate honours them.
- **D — Profile switching is server-side.**
  - A device's child is stored on the device row: `assigned_profile_id` for a personal device, or `active_profile_id` for a shared screen. A device never reads the child from a cookie.
  - On a shared multi-child screen, picking or switching needs the family PIN. PINs are now scrypt-hashed, and a screen locks for 5 minutes after 5 wrong tries (stored per device).
  - The old default PIN `1234` doesn't count as set, so shared screens stay closed until a parent sets a PIN.
  - Personal devices can't switch. Parents assign devices under **Devices**.
  - With no child resolved, every kid page redirects to **Who's watching?**, and `authorize` denies.
  - The remote works throughout. The PIN pad takes remote arrows and OK, the number keys, or touch.
- **E — Legacy permissions.** See migration below. Ambiguous approvals grant nothing. They go to a "held for review" list on the **Review** page, where the parent assigns each to a child or dismisses it.

Kid-side indicators are also child-scoped now: pending requests, running checks, and "A grown-up said yes!".

## Migration `0018_child_scope.sql` (Supabase) and its local twin

**Run order matters.** Apply 0018 immediately before deploying this branch. The current `main` code doesn't send a child, so after 0018 the database rejects `main`'s approvals. And this branch's code can't run without 0018's columns.

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

**Rollback:** `supabase/rollbacks/0018_child_scope.down.sql` restores the whitelist exactly from the snapshot and drops everything 0018 added. Approvals and assignments made after 0018 are discarded, as the file header says.

**Local store:** `migrateLocalToChildScope()` in `src/lib/db/local.ts` runs once, keyed on `schema: 18`. It applies the same rules, except that it has no request or check history: legacy approvals are attributed only in one-child families. It also keeps `whitelistPre0018` so the change can be undone.

**Requires Postgres 15+** (`NULLS NOT DISTINCT`, and `SET NULL (column)`). Supabase projects are 15 or newer. Confirm yours under Settings → Infrastructure before running.

## Tests

`npm test` runs Vitest: 106 tests in 5 files.

| file | covers |
|---|---|
| `src/lib/gate.test.ts` | review eligibility (missing / sample / low-confidence / malformed); channel ≠ approval in all three modes; mode semantics; tags, formats, age min/max; peer flags restrict but never clear; child-scoped overrides; blocks (child and family-wide, beats allow); open clearance doesn't persist across mode changes or reach a sibling; fail-closed cases; grant-index scoping; advance re-derivation |
| `test/migration-0018.test.ts` | every real migration 0001→0018 in PGlite (Postgres 17, WASM); backfill attribution; ambiguous rows held with candidates and leaking nothing; age fill; check constraint; cross-family FK rejection (whitelist, requests, devices); NULLS NOT DISTINCT dedupe; delete-child cascade and unlink; exact rollback; second run fails loudly |
| `test/grants.test.ts` | grant writes against the real local store in a temp directory: requests allowed for the asker only; "never everyone"; cross-family refused; queue decisions replace only that child's decision; open clearance recorded for the checker only; Add & review isn't permission; scope-exact dedupe and removal; no child → refused; delete cascade; local migration twin, including undo; held legacy approvals grant nothing until assigned |
| `test/pin-and-pick.test.ts` | PIN hashing/salting, legacy plain PINs, "1234 isn't set", lockout and unlock; device→child resolution (personal beats picked, single child, shared, nobody, cross-family, stale assignment) |
| `test/single-gate.test.ts` | guard rail: kid pages and kid actions don't read family-wide flags, don't build a library without a child, don't call `db.getSettings` (which falls back to the first child), and don't define their own review eligibility |

**Other checks:**
- `tsc --noEmit` passes, `eslint` is clean, and `next build` passes.
- Local smoke run:
  - **One child:** the kid screen resolves automatically. Search bounces in Locked mode. The seed video, which has only a sample card, now 404s on `/watch/<id>`; before this change it played.
  - **Two children, none picked:** every kid page redirects to "Who's watching?", which asks for the PIN.

## Limitations and notes

- **Not run against your Supabase database.** The migration ran in PGlite (Postgres 17) against every migration in the repo, not your live data. Read the backfill output (`select * from legacy_grants`) after running it.
- **Local dev mode keeps the active child in a cookie.** There's no device table locally, and it's still only set by the PIN-checked action. Supabase mode stores it on the device row.
- **Restrictions apply at the next advance, not mid-video.** A restriction added while a video is playing takes effect at the next advance, skip or page load; the current video isn't cut off.
- **A parent previewing the kid screen picks a child without a PIN**, because they're signed in. That choice lives in the parent's cookie.
- **Low-confidence cards aren't automatically re-reviewed.** They show up in the parent's review queue as "Review wasn't confident enough."
- **`profiles.hide_unreviewed` is kept but ignored**, and its checkbox is removed.
- **Vitest is installed with `--legacy-peer-deps`.** npm 10's resolver crashes on Vitest's optional browser-runner peers. That flag affects only the dev-only test runner; no runtime dependency changed. PGlite is dev-only too.
- **The demo family's PIN is `1234`**, set as a real hashed PIN. The demo page tells reviewers.
