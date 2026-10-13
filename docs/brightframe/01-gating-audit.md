# Content-gating & permission audit

Branch `feature/brightframe`. Read-only audit; no behavior changed yet.

**The rule we're enforcing.** A video may play automatically for a child only if (a) it has an eligible content review and passes that child's rules, or (b) a parent explicitly approved that specific video for that child. A channel approval is not approval of its unreviewed videos. Approvals are child-scoped. Locked / Open / Ask First stay distinct. No peer-review-based clearance.

## How it works today

**Storage.** One `whitelist` table keyed `(family_id, kind, target_id)`. There is no child column. Kinds:

| kind | written by | meaning today |
|---|---|---|
| `channel` | approve channel, starter pack, demo | every video on the channel enters the family library |
| `video` | approve a single video (search/paste/card page) | video enters the family library |
| `override` | approve a kid's request, "Allow" in the review queue | bypasses all filters, **including "not reviewed"** |
| `auto` | a kid's open-mode check that passed | video enters the family library |
| `block` | "Never" in the review queue | never plays |
| `dismissed` | "Keep hidden" in the review queue | stays hidden; drops out of the queue |

Child-level rules live on `profiles`: mode, blocked tags, blocked formats, `hide_unreviewed`, age, check limit. The family holds `flag_threshold`.

**Decision path.** `getLibrary(familyId)` joins every video with its card, crowd tallies and the family's whitelist. It sets `whitelisted = !block && (channel || video || override || auto)`. Then:

- `blockedReasons(v, settings)` (`src/lib/gate.ts`) returns, in order:
  1. `block` → "Blocked by a parent"
  2. `override` → nothing (always allowed)
  3. no card and `hideUnreviewed` → "Not reviewed yet"
  4. otherwise: blocked format, and each blocked tag where the AI found intensity ≥ 2 (unless ≥ threshold parents voted "over-called"), or ≥ threshold parents flagged it as missed
- `aiPasses(v, settings)` = real (non-sample) card + no blocked reasons + confidence ≥ 0.7 + `ageFit.min ≤ kidAge`
- `canPlay(v, settings)`: block → no; whitelisted → `blockedReasons` empty; otherwise only if mode is `open` and `aiPasses`

**Enforcement points.**
- `/watch/[id]` 404s unless `canPlay`; the auto-advance playlist is built from the same filter. This is the real server-side gate, and it's sound.
- The kid home builds its shelves with its own `whitelisted && blockedReasons` check, not `canPlay`.
- Search shows Play only when `canPlay`. "Check it" reviews the video, then either writes `auto` and plays, or files a request.

## Gaps

Ranked by how directly they violate the rule.

1. **Unreviewed channel videos can play.** If a parent unticks "Hide videos until they have a content card" (`hide_unreviewed`), step 3 is skipped and every unreviewed video on an approved channel plays. This directly breaks "channel approval ≠ approval of unreviewed videos."
2. **Sample cards count as reviews.** `blockedReasons` only checks that a card exists. Seed/sample cards (`reviewer.model = "sample"`, four in `data/seed.json`) let a video through on the home screen and in `/watch`. `aiPasses` excludes them; the channel path doesn't.
3. **Approvals aren't child-scoped.** `override`, `auto`, `block` and `dismissed` are all family-wide:
   - Approving Maya's request (`resolveWatchRequest` ignores the request's `profile_id`) authorizes the video for Leo too, unreviewed or not.
   - A passing open-mode check by Maya writes `auto`. That puts the video on **Leo's** home screen even if Leo is in Locked mode. Leo's tag filters still apply, but his age fit doesn't.
   - The review queue says "Allow for Maya" but writes a family-wide override.
4. **Channel videos skip age fit and confidence.** `aiPasses` (age ≤ kid, confidence ≥ 0.7) only applies to the open-mode search path. A reviewed video on an approved channel rated 10+ or reviewed at 0.4 confidence plays for a 4-year-old. Whether age and confidence count as "the child's viewing rules" is a call for you (see decision B), but today the two paths disagree.
5. **Peer votes can clear content.** In `blockedReasons`, ≥ `flagThreshold` "over-called" votes neutralize an AI tag hit and can turn a hidden video playable. That is peer-review-based clearance, which is out of scope for now. Peer "missed" flags only ever restrict, which is fine.
6. **`video` vs `override` semantics.** Approving a single video from search or the card page (`video`) is *not* treated as explicit approval: it still needs a review and must pass filters. Approving a request (`override`) bypasses everything. Both say "Approve" in the UI. That's a reasonable design, but it should be deliberate and labelled (decision A).
7. **Duplicated gate logic.** The kid home, search, play page, `settleCheck` and the parent dashboard each recompute eligibility slightly differently. A future change to one will miss the others.
8. **Kids can switch profiles freely.** "Who's watching?" has no lock, so Leo can pick Maya's tile and get Maya's permissions. Child-scoped approvals are only as strong as profile selection (decision D).
9. **Minor issues:**
   - `toggleWhitelist` trusts `kind` from the form (parent-only, but it should be validated).
   - The "A grown-up said yes!" and pending-request indicators are family-wide.
   - `getLibrary` loads every video in the shared library on every request. That's a performance concern, not a gating one, but it'll matter.

## Recommended changes

**Schema** (migration `0018_child_scope.sql`):
- Add `whitelist.profile_id uuid null references profiles on delete cascade`. `null` means all children in the family.
- Replace the primary key with a unique index on `(family_id, coalesce(profile_id, '00000000-…'), kind, target_id)`.
- Constrain: `override`, `auto`, `block` and `dismissed` must have a `profile_id` (check constraint). `channel` and `video` may be family-wide or per-child.
- Backfill:
  - `override` → the profile of the approved `watch_request` for that video, if one exists.
  - `auto` → the profile of the passing `kid_check`.
  - `block` / `dismissed` → one row per profile (restrictive, so copying is safe).
  - Any `override` / `auto` that can't be attributed → one row per profile, preserving today's behavior. The migration reports these so you can review them.
- Leave `profiles.hide_unreviewed` in place but stop reading it.

**Logic.** Replace `blockedReasons` / `aiPasses` / `canPlay` with one pure function in `src/lib/gate.ts`. Every surface calls it: play page, home shelves, search tiles, `settleCheck`, the parent dashboard's "visible to Maya" counts, and the kid screen miniature.

```
authorize(video, child, grants) → { allow, basis, reasons }
  1. child-scoped block                         → deny  "Blocked by a parent"
  2. child-scoped explicit approval (override)  → allow basis: explicit
  3. no eligible review                         → deny  "Not reviewed yet"
       eligible = real model (not sample), confidence ≥ 0.7, no failed parse
  4. child rules: blocked tags (AI ≥ 2, or ≥ threshold parent flags — restrict only),
     blocked formats, age fit (decision B)      → deny with reasons
  5. a source that lets it in for this child:
       channel or video grant (family-wide or this child)  → allow basis: library
       mode = open (reviewed + passes rules)               → allow basis: open
       mode = locked | open_ask                            → deny  "Not in library"
```

Action changes:
- `resolveWatchRequest` and `decideVideo` write grants scoped to the request's or the queue's child.
- `settleCheck` writes `auto` scoped to the checking child.
- `toggleWhitelist` validates `kind`.
- The "hide unreviewed" checkbox is removed from settings.

**Not changed:** mode semantics, the AI pipeline, crowd flags as restrict-only signals, billing, TV navigation, the skip budget.

## Decisions needed before I build

- **A. What does "Approve" on a single video mean?** Options: add to the library (still needs a review and must pass that child's rules), or explicit approval (plays even if unreviewed). I recommend library-add for channel/search approvals, with explicit approval reserved for "Allow for Maya" from a request or the review queue, worded to say so.
- **B. Age fit and confidence.** Should they gate channel videos too (recommended), or only open-mode search?
- **C. Channel approvals: family-wide (today) or per child?** I recommend keeping family-wide for now, with the schema already supporting per-child, and adding a per-child exclusion later if needed.
- **D. Profile switching.** Should a kid be able to pick another kid's tile? Options: leave it open (like Netflix Kids), require the parent PIN to switch, or let the parent pin a device to one child.
- **E. Ambiguous legacy overrides.** OK to expand them to all children at migration, then list them for you to re-scope?

## Test plan

There's no test runner yet. I'll add **Vitest** (unit, no network, no database) and a `npm test` script.

1. **`authorize` unit tests** (`src/lib/gate.test.ts`, table-driven fixtures):
   - unreviewed video on an approved channel → deny, in every mode
   - sample card → deny; low-confidence card → deny
   - reviewed, passes rules, approved channel → allow (all modes)
   - reviewed, passes rules, not in library: locked → deny, open_ask → deny, open → allow
   - blocked tag at intensity 2 → deny; at intensity 1 → allow
   - blocked format → deny
   - age fit above the child → deny (per decision B)
   - parent "missed" flags ≥ threshold → deny; "over-called" votes ≥ threshold → **still deny**
   - override for Maya → allow for Maya even unreviewed; **deny for Leo**
   - block for Maya → deny for Maya; Leo unaffected
   - `auto` from Maya's check → Leo in locked mode **cannot** play it
   - family-wide channel grant + child-scoped block → deny for that child only
2. **Grant-scoping tests** for the action logic, run against the local JSON store in a temp directory:
   - approving a request writes a grant for the requesting child only
   - "Allow" from the review queue writes a grant for the selected child only
   - a passing check writes `auto` for the checking child only
   - "Never" scopes to the child
3. **Surface-consistency test.** For a fixture library, the home shelves, search Play buttons and `/watch` playlist all equal `authorize(...).allow`, so the duplicated-logic gap can't come back.
4. **Migration test.** Run the backfill against a fixture of today's rows and assert the per-child result, including the reported ambiguous rows.
5. **Every stage runs** `tsc --noEmit`, `eslint`, `next build` and `npm test`, and I'll report the results.

**Out of scope for tests:** YouTube embed behavior inside the iframe, and Supabase RLS. The server uses the secret key; RLS is defense in depth and stays as is.
