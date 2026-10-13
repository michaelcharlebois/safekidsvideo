# Brightframe design — Phase 2 (Review inbox, video page) and data fixes

The Phase 1 design system is unchanged. Routes, server actions and the authorization rules are unchanged.

## Data fixes before the redesign

- **One definition of a child's content** (`src/lib/kid-home.ts`), used by the kid home screen and the parent dashboard.
  - **inventory:** what's in the child's library at all.
    - Content sources, explicit "Allow for <child>", and Open-mode clearances, the last only while the child is in Open mode.
    - Blocked, kept-hidden and unreviewed source videos stay in it (with their status), so a parent can still find and manage them.
    - A stale Open-mode clearance doesn't count for a Locked or Ask-First child.
  - **playable:** inventory ∩ `authorize()`.
  - The dashboard's "Ready" count, its library list and its kid-screen preview all come from this. The preview now shows the first real shelves with the kid screen's own titles.
- **Review badge = the whole family** (`src/lib/inbox.ts` → `pendingDecisions`). It counts:
  - each pending request
  - each (child, video) the gate holds back and the parent hasn't decided on
  - each unresolved old approval record

  **Dedup:** a held item is dropped when that same child already has a pending request for that video. Two children deciding on the same video are two decisions.

  **Per-child counts** (sidebar and filter chips) include what concerns that child: their requests and held videos, plus unattributed requests and old records listing them. So per-child numbers can add up to more than the total.
- **Tests:** `test/inventory-and-inbox.test.ts`. It covers a blocked source video, stale Open-mode clearances, another child's grants, kid home matching dashboard, and two children with different pending decisions.

## Review (`/parent/review`)

- **An inbox of every pending decision across all children,** with filter chips ("Everyone", then each child).
- **Each item says which child it affects and where it came from.** Child's request (apricot), held back after AI review (amber), or old approval record (neutral). An old request that didn't record a child says so.
- **The decision comes first:** title, channel, a one-line "why", what holds it back for that child, then the actions.
  - Held videos: **Allow for [child]**, **Keep hidden**, **Never for [child]**.
  - Requests: **Allow for [child]** and **Not now**, plus a child picker for unattributed requests.
  - Old records: **Allow for** each candidate child, and **Don't allow**.
  - "What each choice does" explains the four choices once, collapsed, at the top.
- **Without a usable AI review** (none, low confidence, incomplete or sample), the item says so and that allowing will ask for confirmation. The server-side confirmation and its card are unchanged.
- **Desktop** shows the AI review beside each decision. **On a phone** it's behind "What the AI review found", below the actions.

## Video page (`/parent/video/[id]`)

- **Who can watch this** is the decision column: first on a phone, a sticky right-hand column on desktop. Each child gets:
  - a status badge
  - one sentence on what decides it: "Passes the AI review against Maya's settings", or "You allowed it for Maya. This overrides the AI review…", or "You chose Never / to keep it hidden", or the reasons it doesn't play
  - the actions
- **A short key** defines "Passes the AI review" against "Allowed by you".
- **Family-wide blocks** keep the Phase-1 controls. They now say the block also applies to children added later; the per-child split doesn't.
- **Three sections, kept separate:**
  1. **AI review:** assessment tags, reviewer's note, findings with intensity, timestamp and evidence. Worded as "an assessment, not a guarantee".
  2. **Other parents:** other families' feedback only.
  3. **Your feedback on the review:** hidden until there's a review.
- **The player** is a thumbnail until tapped ("Watch it yourself"), so a phone isn't pushed down by a large player and no YouTube embed loads unasked.

## Decisions beyond the approved specification

1. **Review shows a list instead of one card at a time with "Skip".** Same actions; `?skip=` is no longer used. Long lists show 25, then "Show all".
2. **Requests keep their existing actions** (Allow / Not now). Reference 04 shows Keep hidden on a request; adding it would combine two actions, which is new behaviour. Easy to add if wanted.
3. **The Review badge includes old approval records,** because they're decisions on the Review page.
4. **The player is click-to-load on desktop too.**
5. **Dashboard backlog items done here because they were small:**
   - "Being reviewed" → **"Awaiting review"**: nothing says a review is running when none is.
   - Channel reorder buttons are 36px touch targets on phones.
   - The kid-screen preview uses the real shelves.

   The question of a dedicated Library destination is still open; no new page was added.

## Screenshots (`phase2/`)

These are the real app in local mode with the UX fixture family. Thumbnails are placeholders, because the sandbox can't reach YouTube images.

Kid requests are Supabase-only, so the request items aren't in these screenshots; they use the same card with the apricot "Child's request" label.

Files:
- `review-desktop`, `review-mobile-1`, `review-mobile-expanded`, `review-confirm-mobile`
- `video-desktop` (one child allowed by the parent, one held back), `video-mobile-1` / `-2`, `video-unreviewed-desktop`
- `dashboard-mobile`
