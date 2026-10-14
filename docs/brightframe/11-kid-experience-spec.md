# Brightframe kid experience: audit and UX specification

Scope of this phase:
- **Built:** a representative kid **Home** for TV, tablet and phone.
- **Not yet:** the player, search, request and PIN screens. They keep their current design until reviewed.
- **Unchanged:** the authorization gate and every server-side check.

## 1. Audit of the current kid routes

| Route | What it does | Authorization | Design today |
|---|---|---|---|
| `/watch` (Home) | Shelves: "A grown-up said yes!", Keep watching, For [child], one per channel | `kidHome()`: inventory ∩ `authorize()` for the selected child; no child → Who's watching | One layout for every device; navy and yellow from the old Sift palette; emoji icons; Fredoka (not loaded, so a system font) |
| `/watch/[id]` (player) | Full-bleed YouTube player, skip budget, auto-advance | Page checks `authorize()`; every advance re-asks the server (`nextVideo`) with a fresh playable list | Remote-first; keys handled in the player |
| `/watch/search` | YouTube search (Ask first / Open), "Let's check it!" (Open), "Ask a grown-up" | Locked → redirected to Home; results pass `authorize()`; checks and requests are server actions | Text field relies on the TV's own keyboard |
| `/watch/who` | Who's watching; PIN pad on shared screens; a child's own screen can't switch | `selectProfile` server action with the atomic PIN lockout (0019) | Large tiles; PIN pad works with arrows, OK and number keys |
| `/pair` | Pair a TV or tablet with a code | Server-side code check | Plain |
| Layout | Header (Home, Search, child, full screen, grown-up exit), time-up wall | `timeState()` for the selected child | The same header on every device |

**Shared plumbing that works and is kept:**
- `RemoteNav`: geometric D-pad navigation in rows, Samsung (10009) and LG (461) Back codes, a debug HUD (press 0 three times).
- `ExitButton`: press-and-hold or five taps, leading to the PIN or sign-in-protected parent area.
- `AllDone`: the time-up wall.
- The skip ledger.

**Problems found:**
1. **Not Brightframe:** the colours, type and emoji don't match the approved system.
2. **No real TV layout:**
   - Tile titles are 1rem and there are no overscan-safe margins.
   - Focus is a yellow ring only, and the header row is crowded on a phone.
3. **Tablet and phone get a desktop shelf layout:** horizontal scrolling rows with small titles. Phones see one and a half tiles per row.
4. **No home-screen view of requests:** a child who asked can't see "waiting for a grown-up" on Home.
5. **Mode shown inconsistently:** Locked, Ask first and Open aren't explained to the child. The Search button simply disappears in Locked.

## 2. Non-negotiables, and how the design keeps them

| Rule | How |
|---|---|
| No unreviewed video plays unless allowed for that child | Every Home renders only `kidHome().playable` (the same selector as today). Tiles link to `/watch/[id]`, which re-checks `authorize()`. Nothing on Home plays inline. |
| The same child gate on every platform | One server page computes the data once; the three layouts only *present* it. No layout fetches or filters content on its own. |
| Locked, Ask first and Open match the parent settings | The mode comes from the child's settings. Locked: no Search, and "A grown-up picks your videos". Ask first and Open: Search; and an "Ask" path. |
| No parental controls in the kid UI | Only the existing hold-to-exit button (parent area behind PIN or sign-in). No settings, approvals or library actions. |
| A real remote works on TV | Arrows, OK/Enter and Return/Back (Samsung 10009, LG 461) only; no pointer needed. Large targets, focus always visible, a predictable row model. |
| Limits, skips and authorization at every transition | Untouched: `timeState()` gates the layout; the player keeps the skip ledger and server-side `nextVideo`. |

## 3. Choosing the interface

- **TV** when the user agent is a TV engine (Tizen / SMART-TV, Web0S, Android TV, Fire TV `AFT`, BRAVIA, CrKey).
  - The Samsung wrapper is Tizen, so it's detected without changes.
- **Otherwise touch**, and the width decides: under 640px is the phone layout, 640px and up is tablet.
- **Override:** `?ui=tv|tablet|phone` remembers a choice in a cookie (`bf_ui`), for testing and for a device that guesses wrong. `?ui=auto` clears it.
  - The override changes presentation only, never what can play.

## 4. Shared vs platform-specific

| Shared (one implementation) | Platform-specific |
|---|---|
| Data: `kidHome()` shelves, mode, child, pending requests, today's remaining time | Layout and navigation model |
| `KidCard` (thumbnail with the branded fallback, title, duration, state badge) in three sizes | Focus treatment (TV: 6px apricot ring and lift; touch: press state only) |
| State vocabulary: "A grown-up said yes!", "Waiting for a grown-up", "Time left today" | Header (TV: one focusable row; tablet: top bar; phone: compact bar plus bottom tabs) |
| Theme tokens `.kid-bf` (forest ground, ivory text, apricot focus), Plus Jakarta Sans, Brightframe mark | Card size and type scale (TV 10-foot, tablet comfortable, phone compact) |
| Hold-to-exit, time-up wall, `RemoteNav` key handling | Shelf behaviour (TV: horizontal rows; tablet: 3–4 column grids; phone: one column) |

## 5. The three interfaces

### TV (remote-first, 10-foot)
- **Margins:** 5% horizontal and 4% vertical safe areas (overscan).
- **Type sizes:** shelf titles 32px, card titles 22px, body text at least 20px.
- **Header** (one focus row): Brightframe mark, then Home, Search (not in Locked), and the child's chip (only if switching is allowed). The grown-up exit sits at the far end, small.
- **Shelves:** horizontal rows of cards about 22% of the screen wide (four and a bit visible), so the next card is always partly in view.
- **Focus:** the card lifts (scale 1.06) with a 6px apricot ring and a dark halo; the title brightens. Focus is never lost: the first card is focused on load.
- **D-pad:**
  - left and right stay in the row (no wrap);
  - up and down change rows and keep the closest column;
  - OK opens the video;
  - Return goes to Home, and on Home leaves the app (Tizen) as TV apps do.
- **Waiting for a grown-up:** a row of requested videos shown as not playable; they aren't focus targets that lead anywhere.
- **Keyboard and PIN (next phase):** an on-screen A–Z / 0–9 grid driven by arrows. The current PIN pad already works with arrows, OK and number keys.

### Tablet (touch-first)
- **Top bar:** mark, "Hi, Maya", and large Home / Search pills (48px or more).
- **Content:** grids of large cards (3 columns at 640–1023px, 4 at 1024px and up), each section with a short friendly title. "A grown-up said yes!" comes first when present.
- **"How to get more videos"** explains the child's mode in one line, with the Ask path:
  - Locked: "A grown-up picks your videos."
  - Ask first: "Find something and ask a grown-up."
  - Open: "Search, and Brightframe checks it first."
- **Waiting for a grown-up:** shown with a clear badge.
- Time left today appears as a quiet chip.

### Phone (touch-first, vertically efficient)
- **Compact top bar:** mark and child.
- **Content:** one column of wide cards. Each section shows 4, with "Show all" expanding in place. No horizontal scrolling.
- **Bottom tab bar** (thumb reach, 56px): **Home**, **Search** (Ask first and Open only), and **Ask** (opens Search with a prompt in Ask first; in Locked it explains that a grown-up picks videos).
- Cards show the title in at least 17px, with no secondary metadata.
- Time left today sits under the greeting.

## 6. Built in this phase vs next
- **Built:** Home for all three, the `.kid-bf` tokens, `KidCard`, interface detection with an override, a D-pad test on the TV Home, and screenshots.
- **Next, after review:**
  - player controls (TV overlay and touch)
  - search with an on-screen TV keyboard
  - request flow and states
  - Who's watching and PIN in the new design
  - the time-up wall
  - the full Samsung remote checklist on a real TV

## 7. Checkpoint results (Home)

**Screenshots** (`phase6/`), taken in local mode with the UX fixture. Thumbnails show the branded fallback because the screenshots were taken offline.
- **TV:** `tv-home.png`, plus `tv-dpad-1-right`, `tv-dpad-2-down` and `tv-dpad-3-header`, showing focus moving.
- **Tablet:** `tablet-home-landscape.png`, `tablet-home-portrait.png`.
- **Phone:** `phone-home-1.png`, `phone-home-2.png`, and `phone-ask.png` (the Ask sheet).

**D-pad test** (`scripts/e2e/kid-home.sh`, 12 of 12):

| Check | Result |
|---|---|
| Interface choice | A Samsung Tizen user agent gets the TV interface with no override |
| Focus on open | On the first video |
| Right, Right | Moves along the shelf |
| Down | Next shelf, nearest column |
| Right at the end of a row | Stays in the row |
| Up, Up | Reaches the header |
| OK | Opens the focused video |
| Samsung Return (keyCode 10009) | Back to Home, with focus on a video again |
| Tablet and phone widths | Get their layouts |
| Links on Home | Lead only to the player, search, or Who's watching |

**Gating walkthrough:** its "shared TV" now uses the Samsung user agent, and still passes 40 of 40.

**Limitations:**
- **Real remote:** the D-pad test sends keyboard events, including the Samsung Return keyCode, through a browser. It isn't a physical remote; the Samsung TV checklist in `06-before-production.md` still applies.
- **Requests:** "Waiting for a grown-up" needs Supabase (pending requests), so it doesn't appear in the local screenshots.
