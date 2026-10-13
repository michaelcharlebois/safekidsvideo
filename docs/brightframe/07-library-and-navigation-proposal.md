# Proposal: Review vs Library, and the parent navigation

Status: **for approval**. Nothing here is implemented. The gate, grants and playback authorization stay as they are.

## 1. What happens today

`pendingDecisions()` (`lib/inbox.ts`) builds three kinds of item:

| Item | When it appears | How often |
|---|---|---|
| **request** | A child asked for a video (Ask first, or Open when a search result is held). Old requests that didn't record a child are their own item. | Occasional |
| **held** | `needsDecision`: the video is in the child's library, has a real AI review, the parent hasn't allowed, hidden or blocked it, and the gate holds it back. That covers concern findings, age, format, other parents' reports, **and** low-confidence or malformed reviews. One item per child per video. | Grows with library size × children |
| **legacy** | Each unresolved pre-0018 approval. | One-off, from the migration |

These counts drive five places:
- the **Review badge**, family-wide (sidebar or tab bar)
- the **per-child badges** in the sidebar
- the **"Needs your decision"** tile and card on Home
- the **"Asking: N waiting in Review"** row on Kids and on the child page
- the Review page itself

Phone push notifications are sent only for child requests, plus the evening check-in and extra time. A held video never sends a push. So the noise you describe is **badge and count noise**, not push noise. With a few hundred channel videos and two or three children, it would be in the hundreds.

**The real problem with the current model** goes beyond noise. The only way to clear a held item without allowing it is **Keep hidden**, and Keep hidden is a *standing* restriction that survives later settings changes. A parent who tidies the inbox would quietly create hundreds of permanent restrictions. If they later relax a child's filters, none of those videos would come back. The inbox teaches the wrong action.

## 2. Your proposed model: agreed, with two refinements

| | Review (actionable inbox) | Library (inventory) |
|---|---|---|
| Child requests, with or without a named child | ✔ unchanged | shown as "Asked for" |
| Legacy records | ✔ unchanged until resolved | — |
| **Held, and you added that video yourself** (not via a channel) | ✔ *refinement 1* | ✔ |
| Held by filters, age, format or reports, arriving via a channel | — | ✔ "Held back", with the reason and actions |
| Real review but low confidence or malformed | — *refinement 2* | ✔ "Held back: couldn't be sure" |
| Awaiting review (none yet, or a sample) | — | ✔ |
| Plays / Allowed by you / Kept hidden / Blocked | — | ✔ |

**Refinement 1: a video you added yourself that turns out to be held is a genuine open question.**
- Adding a single video is a clear intent ("I want Maya to have this"). The filter contradicts it, so you should hear about it once.
- A video that arrived through a channel is the filter working as designed.
- To tell them apart, Review needs to know whether a video-kind library entry exists. That's already in the whitelist. Adding a channel never creates Review items.

**Refinement 2: low-confidence and malformed reviews stay out of Review.**
- They're conservative holds. The safe outcome is already in force.
- They can be numerous: a channel of ambiguous cartoons could be dozens.
- Library gets a "Couldn't be sure" filter, so you can look deliberately.
- If you'd rather treat them as unresolved, include them only when you added the video yourself (as in refinement 1). I'd avoid putting all of them in Review.

**What stays exactly the same:**
- the gate (`authorize`) and every playback check
- what Allow / Keep hidden / Never / Not now do, and the server actions behind them
- child-scoped blocks, family-wide blocks, and overrides
- the request flow and its push
- dedup: a held item is dropped when the same child has a request for that video

The held-video actions move with the content: on a held video in Library (and on the video page, where they already exist) you can **Allow for Maya**, **Keep hidden** or **Never for Maya**.

### Effects on counts

| Place | After the change |
|---|---|
| Review badge | requests + legacy + direct-add holds. Usually single digits. |
| Per-child sidebar badges | The same, per child. Unattributed requests and legacy records still count for every candidate child, as now. |
| Home "Needs your decision" | Same as Review. A separate, neutral **"Held back"** tile (not warning-coloured) links to the Library filter. |
| Kids / child page "Asking" | Mostly requests now, which is what that row is meant to say. |
| Library nav item | **No badge.** Nothing there is urgent by definition. |

**Side benefit:** the badge no longer needs every child's full library. It needs requests, legacy records and the family's directly added videos. That largely solves backlog item 2 in `06-before-production.md` (the badge cost growing with the catalogue). The full inventory is computed only on Library and Home.

### Edge cases and trade-offs

- **A settings change holds back many videos at once** (e.g. blocking "monsters" for Leo). Today this floods Review. After the change there's no badge. The save confirmation says it instead: "Saved. 42 library videos are now held back for Leo. See them in Library." It's computed at save time and needs no new data.
- **Locked children can't ask.** A held channel video for a Locked child is only discovered by browsing Library. That fits Locked ("you choose what Leo watches"), and per-channel counts make it visible: "12 of 40 play for Leo".
- **A parent who wants to see everything** can open Library → Held back for each child. Nothing is lost, only demoted.
- **Existing Keep hidden decisions** stay valid and appear under "Kept hidden" in Library, where they can be undone. Keep hidden becomes a deliberate choice ("even if Leo's settings change later"), not inbox housekeeping.
- **A request for a video that's also held:** unchanged. The request is the decision.
- **A newly reviewed channel video** goes straight to its status in Library and never appears in Review.
- **Tests that change:**
  - `inventory-and-inbox.test.ts`: held items now need a direct add.
  - The walkthrough check "review queue shows the filtered video for Maya" moves to Library.
  - New tests: channel-only holds create no Review item; a direct-add hold does; counts match the page.

## 3. Library as a destination

`/parent/library?kid=…` is per child, like Home. The status of a video is per child, because the gate is.

**Library contents**
1. **Videos**, by status, using the labels from Phases 1–2:
   - Plays, Allowed by you, Asked for, Held back (with "Couldn't be sure" as a sub-filter), Kept hidden, Blocked, Awaiting review
   - search, grouped by channel or as one list
   - a held video shows its plain-language reason (`holdExplanation`) and the three actions
2. **Sources**:
   - your channels, in this child's order (the ordering moves here from Home)
   - videos you added yourself
   - **Add a channel**, and starter packs
   - **Reviewed for other families** (the shared library)
3. Channel and video pages belong to Library, so the Library tab is highlighted on them.

**What moves off Home**

| Home section today | Goes to |
|---|---|
| Channels, with the Ready / Awaiting / Held filters, search and video tiles | Library → Videos |
| "Library: what it means for Maya" summary card | Library header counts |
| Add a channel / starter packs | Library → Sources |
| Reviewed for other families | Library → Sources |

**What Home keeps:** who's selected; account notices; the four count tiles (the third becomes "Needs your decision", the held count becomes a neutral tile into Library); the request card; the "On Maya's screen" preview; and Today. Home becomes a short "what's happening" page.

## 4. Five destinations

I recommend **Home · Review · Library · Activity · Kids**, with Account moving out of the main row.
- Activity groups viewing stats, insights and the check-in. Today these are reached from Account and the child page.
- By how often a parent needs each one, Activity is weekly, Kids is occasional, and Account (plan, screens, reviewer, sign-out) is rare.
- **Alternative:** Home · Review · Library · Kids · Account, with Activity inside each child's page. It's less change, but leaves the stats and insights hard to find.

| | Phone (< 768) | Tablet (768–1023) | Desktop (≥ 1024) |
|---|---|---|---|
| Main destinations | Bottom tab bar, five icons with labels | Top bar, five inline labels | Left sidebar |
| Review badge | On the Review tab | On Review | On Review, plus per-child badges in the Children list |
| Account | Account button in the top bar (next to "kid screen") | Same | Sidebar footer, with "Open the kid screen" |
| Child context | Child chips at the top of per-child pages | Same | Children list in the sidebar |

**Per-child pages:** Home, Library and Activity keep `?kid=` when you switch child. Review shows all children unless filtered, as now.

Only Review ever shows a count. Library and Activity never badge.

## 5. Stages after approval

Each stage ships separately, with tests and screenshots.

1. **Selectors.** Change `pendingDecisions` for direct-add holds, add a Library selector, and add the save-time "now held back" note. Counts change; no pages move.
2. **Library page.** Videos by status, with the held-video actions returning to Library. Channel and video pages fall under Library.
3. **Move sources off Home.** Slim Home down and update the Kids and child-page links ("Channel order is on Library").
4. **Navigation.** Five destinations and Account placement, as you choose.
5. **Activity**, then **Account** (Screens, Plan, Reviewer, notifications).

Kid and TV screens are untouched throughout.

## Decisions needed

1. Should held videos **you added yourself** go to Review? (Recommended: yes.)
2. Low-confidence or malformed reviews: Library only (recommended), or Review when you added the video yourself?
3. Destinations: Home · Review · Library · **Activity** · Kids with Account in the header (recommended), or Home · Review · Library · Kids · **Account** with Activity inside each child's page?
4. Library per child (recommended), or a family-wide view with per-child status chips?
