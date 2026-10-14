# Before production — backlog

None of this is done on the branch. Nothing has been migrated, merged or deployed.

## 1. Version-1 AI reviews

**What they are.** Version-1 cards were made before the reviewer started rejecting incomplete answers. If the model skipped a concern category, version 1 wrote it in as "not present", and afterwards that can't be told apart from a real "not present". They're valid at the gate today, so videos they cleared still play.

**Sizing them.** `scripts/staging/v1-reviews.sql` is read-only and runs against production or a copy. It reports:
- total version-1 cards
- version-1 cards whose video is in some family's library. These are the ones that can make a video playable today.
- version-1 videos that a parent explicitly allowed for a child. Those play regardless of the review.
- a rough cost estimate

**Recommended upgrade order.**
1. **Library videos first.** The same SQL's second query exports their URLs. Run `npm run review -- --force --file v1-library.txt` in batches. `--force` skips the daily budget, so size the batches deliberately.
2. **Then everything else:** `npm run review -- --upgrade-v1 --max N` nightly. It goes oldest first and stays within `DAILY_REVIEW_BUDGET_USD`.
3. **A re-review never makes things less safe.** If it fails or comes back incomplete, nothing is written and the version-1 card stays. If it finds something, the gate applies it straight away.
4. **Stricter option, not implemented:** treat version-1 cards as "Awaiting review" until re-reviewed. Every library video would stop playing until its re-review lands. Decide this before launch.

**Known gap.** Tokens spent on a rejected (incomplete) response aren't counted by the daily cost meter, which sums stored cards.

## 2. Cost of the family-wide Review badge

Every parent page renders the shell, and the shell computes the Review badge:
1. `getLibraries(familyId)` reads **every video, card and parent confirmation in the shared catalogue**, plus the family's whitelist.
2. It then builds a scoped library for **each child**.

The cost grows with catalogue size × number of children, and it's paid on every navigation.

| Catalogue | Rough cost |
|---|---|
| A few thousand videos | Fine |
| Tens of thousands of videos (nightly discovery keeps growing it) | Too slow for every page load |

The Kids pages, Review and the dashboard add their own full reads. Options, smallest first:
1. **Wrap the reads in React `cache()`** so one request reads each table once (layout, page and Kids facts share it). Cheap, safe, and could be done next.
2. **Read only what can matter to the family:** videos from the family's channels and added videos, plus videos named in their requests, overrides or blocks; and only their cards and confirmations. Pending decisions can only involve those, and Open-mode clearances are already child-scoped grants. This needs a scoped query in each store.
3. **Keep a pending-count row per family,** updated by the writes that change it (review stored, settings saved, grant changed, request created or resolved). The badge then reads one row. It's more moving parts, and the count has to be checked against the computed list in tests.

Recommendation: (1) now, (2) before opening sign-ups widely; (3) only if needed.

## 3. Still to test on Supabase staging and a real TV

The local walkthrough (31 checks) and the real-Postgres tests can't cover the items below. They need:
- a Supabase **staging** project restored from production data, with 0018–0021 applied
- this branch on a Vercel preview pointed at that project

**Migration rehearsal**
- `npm run test:staging -- prod-data.sql` against a fresh dump.
  - The preflight "must be 0" rows should be 0.
  - Read the list of held legacy approvals and the version-1 counts.
- Apply 0018 and 0019 to staging, then the rollback, then re-apply.

**Kid requests (Supabase-only)**
- Ask from the TV in Ask first and in Open (when a video is held back).
- Approve from the dashboard and from Review, including an unreviewed video (the disclosure appears) and a request that didn't record a child.
- Check the Review badge and per-child counts update.
- Check "Not now" changes nothing about access.
- Push notifications reach the parent's phone.

**PIN and screens**
- Shared TV: pick a child with arrows and OK, and with number keys.
- Five wrong PINs: the lockout and its countdown. Let it expire.
- A second paired device keeps its own counter.
- Make a device a child's own from the child page: you return to that child's Screens section with "… is now Maya's own", and the device can't switch. "Make shared" reverses it.
- Revoke a device mid-session.

**Watch sessions (0020) and per-child requests (0021): not applied. Both go to production before the build that needs them, and only after release approval.**
- Apply 0020, play a video to the end, skip one, leave one with Back: one session each, with the right outcome, in `watch_events`.
- Run `scripts/staging/watch-events-audit.sql` before and after to size the historical double counting.
- Daily limit: with a 30-minute limit, a 20-minute show finished once leaves about 10 minutes.

**Child settings**
- Save each section separately and confirm the others are untouched on Supabase. Columns differ from local mode, so the local test isn't enough.
- Extra time today, then bedtime crossing midnight in the family's time zone.

**Samsung TV (Tizen wrapper), real remote**
- The new TV Home: focus starts on the first video; arrows, OK and Return behave as in `scripts/e2e/kid-home.sh`; text is readable at 3 m; safe-area margins clear the bezel.
- Who's watching and the PIN pad.
- Home rows: left/right within a row, up/down between rows.
- Back and Return.
- Player: auto-advance and skip limits; an allow or restriction taking effect at the next advance.
- 10-foot readability of the redesigned logo on the dark ground.

**Load**
- Time `/parent` with a production-sized catalogue and 3+ children to size item 2 above.
