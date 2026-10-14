# Library checkpoint (for UX review)

This builds the approved architecture in `07-library-and-navigation-proposal.md`, with your four decisions.

**Not done yet, on purpose:**
- Home still has its channel-management sections.
- The main navigation is unchanged. Library is reached from Home's Library card, Review's empty state and the child page. While on Library, the Home tab is highlighted.
- Activity and Account aren't started.
- The kid and TV screens are untouched.

## 1. Review and counts

- **What Review contains** (`lib/inbox.ts`):
  - pending child requests
  - older requests that didn't record a child, labelled **"Older request"**, kept apart from requests by a named child and listed after them
  - unresolved old approval records
- **What it no longer contains:** videos held back automatically. That covers a child's filters, age, format, other parents' reports, and uncertain reviews, whether the video came from a channel or was added one at a time.
- **The badge** comes from requests, old records and the list of children. It no longer reads any child's library, so there's no catalogue scan on every page.
  - The Review page joins only the videos on the page it shows (`getLibrariesFor`).
- **Per-child counts** (sidebar, Kids, child page) are requests that child actually made. Old records and unattributed requests count only in the family total, and show up when Review is filtered to a child they may concern.
- **Kids "Asking for more"** now reads "Maya asked for 2 videos. Waiting in Review."
- **Home "Needs your decision"** counts requests only. The held-back count stays neutral, in the Library card.
- **Unchanged:** the gate, server-side authorization, the unreviewed-video confirmation (now also shown on Library), and request approval.

## 2. Statuses

`lib/status.ts` gains **"Couldn't be sure"**: a real AI review exists but can't be relied on (low confidence or malformed). It's separate from:
- **Held back:** the settings exclude it.
- **Awaiting review:** no review is stored.

Two corrections so nothing implies a review is running when it isn't:
- **"Awaiting review"** copy now says "no AI review is stored yet". It never claims one is in progress.
- **The video page** says "Reviewing now" only when Add & review or Run review actually started a job, recorded with a start time. After 15 minutes with no review stored, it says the review didn't finish and offers to run it again.
  - Previously, Add & review always said "Reviewing now", even with no reviewer configured.
  - After adding a video, the page says what that means: if it isn't reviewed, it won't play for any child unless you allow it.

## 3. Library (`/parent/library?kid=…`)

Library works per child. Switching child keeps you on Library.

**Videos tab**
- Status filters with counts: All, Plays, Allowed by you, Held back, Couldn't be sure, Awaiting review, Kept hidden, Blocked.
  - Each filter has a one-line explanation.
  - Held back says there's nothing you need to do.
  - Kept hidden explains it's a standing choice.
- Search by title or channel.
- "By channel" groups show "N of M play for Maya", four videos each, and "Show all from this channel". "All videos" is a flat list with paging.
- Each row shows the status, the plain-language reason (the same explanation as Review and the video page), and the choices that fit:

| Status | Choices on the row |
|---|---|
| Held back / Couldn't be sure / Awaiting review | **Allow for Maya**, plus "Other choices": Keep hidden and Never, each with what it means. Unreviewed allows ask to confirm first. |
| Plays | "Change for Maya": Keep hidden and Never, tucked beside the video |
| Allowed by you | Undo allow |
| Kept hidden / Blocked | Stop keeping hidden / Unblock for Maya. Family-wide decisions from before per-child permissions link to the video page, which has the existing controls. |

- After each choice you return to the same row with a confirmation, e.g. "Kept hidden for Maya: … It stays hidden even if Maya's settings change."

**Family sources tab**
- A note saying sources are shared by every child and each child's settings decide what plays.
- **Channels:**
  - in this child's order, which sets the order of channel rows on their home screen. That order was already stored per child; it moves here from Home.
  - each with "N of M play for Maya", and Remove (with a confirm step) for every child
- Videos added one at a time.
- Add a channel (search, paste a link, starter packs).
- Reviewed for other families.
- Channel subscriptions stay family-wide; nothing became per child.

**Detail pages** remember where you came from (`?from=review|library`). The back link returns to Review (with its child filter) or to Library. Old links without `?from` go back to Library.

## Tests

- `test/inventory-and-inbox.test.ts`:
  - Review holds only requests and old records.
  - Channel holds, directly added holds and uncertain reviews create no item.
  - Per-child counts are the child's own requests.
  - Ordering.
  - The badge, Kids and Review don't read libraries.
- `test/library.test.ts`: every status from the gate, counts equal the filters, search, channel grouping and order, per-child isolation, and URL filter validation.
- `test/paths-and-back.test.ts`: return paths and back links.
- Walkthrough (34 checks):
  - Review doesn't list a held video.
  - Library → Held back shows it with its reason.
  - Keep hidden from Library is confirmed as a standing choice and survives relaxed filters.

## Screenshots (`phase4-library/`)

These are the real app in local mode with the UX fixture. The fixture now includes an uncertain review, a video added directly, a kept-hidden video and a blocked video. Thumbnails are placeholders offline.
