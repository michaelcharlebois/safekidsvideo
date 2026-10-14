# Kid Search, requests, player, Who's watching and Time up: checkpoint

Branch `feature/brightframe`. Nothing merged, deployed or migrated. brightframekids.com isn't connected.

## Commits

| Commit | What |
|---|---|
| `e6404df` | Search (TV remote keyboard, touch search) and child-scoped request states |
| `660fff5` | Player controls for TV and touch; playback time recorded separately from position (amends unapplied 0020) |
| `5905aa4` | Who's watching, PIN pad and Time up in the kid identity; the old shared kid header removed |

## Search
- **Locked:** no Search (no link; the address redirects Home).
- **TV:** an on-screen keyboard driven by arrows and OK. There's no text field, so the TV's own pop-up keyboard never appears. A connected keyboard also types. Results are one shelf above the keyboard.
- **TV focus:**
  - on open: the first key
  - after searching: the first result
  - back from the player: the result you picked
  - when a result changes state (asked, checked): it stays on that result
- **Tablet and phone:** a normal search field, so the device keyboard appears with a Search key.
  - Tablet: a grid of results.
  - Phone: a list with a count and Show all.
- **Result states** come from the child's own gate (`src/lib/kid-search.ts`). Only Ready is a link, and the player authorizes again.

| State | Child sees | Action |
|---|---|---|
| Plays for this child | ▶ Ready | Opens the player |
| Open mode, not reviewed yet | Not checked yet: "Brightframe watches it first" | Check it |
| Ask first mode, anything new | Ask a grown-up: "A grown-up says yes first" | Ask a grown-up (request made at once; a background review can't make it play) |
| Reviewed, doesn't fit settings / review unsure | Needs a grown-up, with the reason in a child's words | Ask a grown-up |
| Asked, no answer yet | Waiting for a grown-up | None |
| Declined in the last day | Not this time | None |
| Parent chose Never | Not this one | None |

## Requests
- **Asking:** the button turns into "Sent to a grown-up!" for a few seconds, then settles to "Waiting for a grown-up". It's the same element throughout, so a remote's focus stays put.
- **Waiting:**
  - shows on Home (count, never playable) and in Search on every screen
  - nothing to press, so it can't be asked twice
- **Approved:** the video appears under "A grown-up said yes!" on Home and as Ready in Search.
- **Declined:** "Not this time" for a day.
- **Duplicates:**
  - one pending request per child per video (0021 in Supabase; the same rule in local mode)
  - asking again sends no new notification
  - notifications are tagged per child per video, so two children asking for the same video don't overwrite each other

## Player
- **Controls:** Back/Home, −10 s, Play/Pause, +10 s, Next.
  - They hide while playing; paused, "Press OK to play" and "finish this one first" keep them up.
  - **TV, hidden:** OK pauses or plays (and shows the controls); arrows only show them.
  - **TV, shown:** ◀ ▶ move between controls (no wrap); OK presses one.
  - **TV, Return:** always leaves the player, to Search if that's where you came from, else Home.
  - **TV, media keys:** play/pause, play, pause, FF and RW work at any time.
  - **Touch:** controls 56 px and up, Play/Pause 96 px; a tap on the video shows or hides them.
- **Authorization:** unchanged. The page checks `authorize()`; every advance asks the server (`nextVideo`). A one-video list replays instead of stalling.
- **Accounting:** each session's end carries `watched_sec` (time actually played) as well as `ended_at_sec` (playhead).
  - Viewing totals, daily limits, skips and the in-player countdown use playing time, so seeking ahead adds nothing.
  - Closing the app sends the end by beacon.
  - Migration 0020 gains the column. It's still unapplied, and must precede this build.

## Who's watching, PIN and Time up
- **Who's watching:** TV tiles on the remote; big touch tiles.
  - The PIN pad starts on 1 and takes number keys. A wrong PIN says so and clears.
  - `selectProfile` still decides on the server:
    - a PIN on shared screens, with the 0019 lockout
    - no switching on a child's own screen
- **Time up:** calm, one reason at a time:
  - daily limit: "That's all for today, Maya!"
  - done-for-the-day time: "Time to rest, Maya"
  - It says when videos come back and offers "Ask a grown-up for more time". That sends once per child per day from a screen, then says "Already asked". Only a parent can add time.
  - It replaces every kid page on the server, Search and the player included.
- **Chrome:** every kid screen now draws its own TV / tablet / phone chrome. The old shared header is gone. A kid-styled "This one isn't here" covers unknown pages and videos this child can't watch.

## Tests (all local mode, production build)

| Suite | Result |
|---|---|
| `tsc --noEmit`, `eslint .`, `next build` | Clean |
| Vitest | 303 passed, 10 skipped (the real-Postgres tests need `PG_TEST_URL`) |
| `scripts/e2e/gating-walkthrough.sh` | 40 / 40 |
| `scripts/e2e/kid-home.sh` | 17 + 2 + 5 + 2, all passing |
| `scripts/e2e/kid-screens.sh`: `kid-search.cjs` | 35 / 35 |
| `kid-search-askfirst.cjs` | 6 / 6 |
| `kid-player.cjs` | 35 / 35 |
| `kid-who.cjs` | 15 / 15 |
| `kid-timeup.cjs` | 9 / 9 |

### D-pad walkthroughs (keyboard events, including Samsung Return keyCode 10009)

**Search**
- From Home: Up to the header, Right to Search, OK.
- Focus on A. Type "duck" by arrows and OK; Down to Search; OK.
- Focus on the first result. Right reaches the next card, including a card whose only control is its Ask button.
- OK on Ask: "Sent to a grown-up!", and focus stays. After the refresh: "Waiting for a grown-up", focus still on it. OK there does nothing.
- Up reaches the header; Down reaches the keyboard.
- OK on a Ready result opens the player; Back returns focus to it. Return on Search goes Home.

**Player**
- Opens with focus on Pause and controls shown; they hide after about 4 s.
- An arrow while hidden reveals without seeking.
- OK pauses (controls stay); OK plays.
- Right to +10 s, OK ×3: about +30 s.
- Left ×3 to Home; it stops at the first control.
- Return with controls hidden goes Home.

**Who's watching**
- Focus on the first child; Right to the next; OK.
- PIN pad, focus on 1. OK ×4, then arrows to OK: "That PIN isn't right."
- Number keys 2580, then OK: switched (Leo, Locked: no Search).
- Up from the pad reaches Back.

**Time up**
- Focus on "Ask a grown-up for more time".
- OK: "Sent!"
- Again after a reload: "Already asked".

### Functional checks
- **Player accounting:**
  - **Pause and seeks:** with a 1-minute pause and 30 s of seeking, leaving at playhead ~40 s records `watched_sec` of ~15 s.
  - **Repeat play:** a new session id.
  - **End of video:**
    - one "finished" record with ~4 s played
    - auto-advance asks the server
    - a video the parent set to Never just before is skipped, and opening it directly shows no player
  - **App closure:** a beacon with outcome "left".
- **Skips:** after 3 s of play and a jump to 88%, Next still costs a skip. With none left, Next says "Let's finish this one first" and stays.
- **Search and requests:**
  - **Ask first:** Ready results are only what already plays on Home. Asking makes one pending request for that child, and the video still doesn't play.
  - **Parent answers:** approve leads to "A grown-up said yes!" on Home and Ready in Search; decline leads to "Not this time".
- **Profiles:** submitting around the PIN pad with a made-up PIN doesn't switch profiles.

## Screenshots (`phase7/`)

| Screen | TV | Tablet | Phone |
|---|---|---|---|
| Search | `search-tv-keyboard`, `search-tv-typing`, `search-tv-results`, `search-tv-ask-focused`, `search-tv-sent`, `search-tv-waiting`, `search-tv-answered`, `search-tv-askfirst` | `search-tablet-empty`, `search-tablet-results` | `search-phone-empty`, `search-phone-results`, `search-phone-all` |
| Requests on Home | `home-tv-approved` | n/a | n/a |
| Player | `player-tv-controls`, `player-tv-playing` (controls hidden), `player-tv-paused`, `player-tv-focus-fwd`, `player-tv-skip-locked` | `player-tablet-controls`, `player-tablet-paused` | `player-phone-controls`, `player-phone-paused` |
| Who's watching | `who-tv`, `who-tv-pin`, `who-tv-pin-wrong` | `who-tablet`, `who-tablet-pin` | `who-phone`, `who-phone-pin` |
| Time up | `timeup-tv`, `timeup-tv-sent` | `timeup-tablet` | `timeup-phone` |

The screenshots were taken offline:
- Thumbnails show the branded fallback.
- The player shows the kid background where the video would be, because the YouTube player is replaced by a scripted stand-in in tests.

## Known limitations
- **Real hardware:**
  - The walkthroughs send keyboard events in Chromium; no physical Samsung remote was used.
  - Untested on hardware: media-key registration in the Tizen shell, the beacon on Tizen app exit, and 10-foot readability.
  - The Samsung checklist in `06-before-production.md` was extended for this phase.
- **Supabase staging, not verified yet:**
  - pending checks ("Brightframe is watching it first…" across reloads)
  - real push notifications and their tags
  - the 0019 PIN lockout
  - a child's own screen (no switching)
  - `watched_sec` and the beacon writing to `watch_events`
  - 0020 / 0021 behaviour
  - Local mode has no device rows, no watch events and no check log.
- **Real YouTube:**
  - Search in tests is the labelled local practice search over the catalogue (no YouTube key).
  - The player was driven by a stand-in, so real IFrame timing (buffering, autoplay blocking on Tizen) still needs the TV.
- **Time up:** a child whose time is up can't switch to another child from the kid screen (as before). A grown-up uses the parent area.
- **Daily limit variant:** "That's all for today" can't be produced in local mode (no watch events), so only the done-for-the-day variant was screenshotted. Both share one component.
- **More-time de-duplication:** once per child per day per screen (a cookie). A second screen can ask again; the notification tag still collapses it on the parent's phone.
- **Migrations:** 0020 (now with `watched_sec`) and 0021 remain unapplied. 0020 must precede this build.
