# Parent experience checkpoint (for UX review, before any kid/TV work)

## Library refinements

1. **Exceptions are secondary.**
   - On an automatically held video, the reason and its findings come first: each concern, its severity, a timestamp link and who flagged it (the AI review, other parents or the child's settings).
   - **Allow exception for Maya** is a secondary button, next to "Full review".
   - The findings are open under the Held back filter and one tap away elsewhere.
   - The video page does the same: "Allow exception for Maya" is secondary, with "What the review found".
   - Server authorization and the confirmation for unreviewed videos are unchanged.
2. **Phones:** search has its own full-width row, with By channel / All videos below it. The status filters still scroll sideways and keep their arrows.
3. **AI review progress.** There's no stored job state, so the app never says a review is running or has failed.
   - After Add & review or Run review, the video page says **"Review requested. No completed review yet."**, offers to request it again, and suggests refreshing later. Once a review is stored, it simply appears.
   - The same wording is used for Library's "Review 10 now", the channel page and the reviewer's "Learn now".

## Home

Home is now a short overview of the selected child:
- their viewing mode and time limits, with a link to the rules
- **Ready to watch**, **Awaiting review** and **Requests**. Requests are real ones only; held-back videos appear only as a neutral line linking to Library.
- the request card, when there are requests
- **On Maya's screen**: the child's first shelves, from the same selector the kid screen uses
- **Today**: minutes against the limit, and recently watched
- a **Library** card with counts, "Open Library" and "Add a channel"

Moved to Library, with no duplicates left on Home: channel management and ordering, the video inventory and filters, search and adding, starter packs, and Reviewed for other families. Old Home filter links (`/parent?view=…`) redirect to the matching Library filter.

## Navigation

**Home · Review · Library · Activity · Kids**

| | Phone | Tablet | Desktop |
|---|---|---|---|
| Destinations | Five-tab bottom bar (56px targets) | Inline in the top bar | Left sidebar |
| Account | Profile button in the top bar: Account, Screens, Plan | Same | Sidebar foot, under "Open the kid screen" |
| Children | Child chips on per-child pages | Same | Children list with each child's request count |

- Home, Library and Activity carry the selected child. Review shows every child unless filtered.
- Switching child keeps you on the same page and view (filter, tab, search), minus one-off notes from an earlier action.
- Video and channel pages highlight **Library** and keep their back link to Review or Home.
- Account pages highlight nothing in the main row. A bug where `/parent/reviewer` highlighted Review is fixed and tested.

## Activity

Activity brings together the existing viewing stats, history, insights and check-in for one child.
- **Period:** 7 or 30 days.
- **Time:** estimated total, active days, comparison with the previous period, started / finished / skipped, and a daily bar chart (today labelled in text). It explains how minutes are estimated.
- **What Maya watched:** day by day, each video with its minutes and whether it was finished, skipped or left early.
  - The page says how many plays came from screens that didn't record a child (counted for every child), and how many are of videos no longer in Brightframe.
- **Viewing patterns:** channels, kinds of video (with the share of minutes that were reviewed), pace, time of day, and watched most. All come from the existing stats.
- **Check-ins:** the evening question for this child, the recent mood strip, and patterns only once there are about 10 check-ins, described as correlation, not cause.
- **Empty states:**
  - Local mode records nothing, and the page says so instead of showing zeros as facts.
  - With an account but no viewing, it says nothing was watched.
- **Old links:** `/parent/stats` and `/parent/insights` redirect here with the same child and period. `/parent/checkin`, the evening push target, is kept and restyled, and links back to Activity.
- **No new analytics.** The stats computation was split so the same numbers come from data already in hand. History is a pure helper with tests.
- **Design previews:** a deployment that records nothing can show labelled sample data, only with `BRIGHTFRAME_SAMPLE_ACTIVITY=1`, under a "Sample data" notice. It's never used where viewing is recorded. The `desktop-activity-sample` and `mobile-activity-sample-*` screenshots use it.

## Account

- **Account:** family account (who's signed in, children, family PIN status linked to Family settings, sign out or lock), notifications, Screens, Plan, and "More: how the AI reviewer is doing", folded away.
- **Screens:** connected screens, shared or a child's own, and Disconnect with a confirm step. Pairing codes sit alongside. In local mode it explains instead of redirecting to Home.
- **Plan:** the existing billing states and actions, in the design system.
- **Reviewer accuracy:**
  - Parent ratings and disputes.
  - Spend and editable calibration notes stay admin-only.
  - Non-admins see the raw calibration notes only under "Technical".
  - (Local mode counts as admin, so the screenshot shows the admin view.)

## Tests and checks

| Check | Result |
|---|---|
| Unit tests | 246 passed; 9 skipped (real Postgres) |
| New tests | `nav.test.ts`, `history.test.ts` |
| Lint, type-check, production build | Clean |
| Walkthrough | 40 of 40 |

The walkthrough's new checks:
- the video page highlights Library and goes back to Review
- the phone tab bar has the five destinations
- old Home and stats links land in Library and Activity
- Home has no channel management
- Account is in the profile menu

## Limitations

- **Supabase-only behaviour:** viewing, check-ins, screens, notifications and requests need Supabase, so local screenshots show their empty or local-mode states. Real Activity data must be checked on staging.
- **Support email:** still `hello@siftkids.com`. I haven't changed it to a brightframekids.com address because that domain isn't connected yet.
- **Kid and TV screens:** untouched, as asked.
