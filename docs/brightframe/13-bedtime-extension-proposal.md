# One-night bedtime extension (approved and implemented)

Approved with four decisions and refinements. Built in migration 0023, `src/lib/bedtime.ts`, `src/lib/bedtime-store.ts` and `src/lib/more-time.ts`. **Not applied anywhere.**

## The rules
- **Separate from daily minutes:**
  - A bedtime extension never adds viewing minutes.
  - Extra minutes never lift bedtime.
  - If the minutes are also used up, an extension alone doesn't restore playback. The child sees the daily-limit screen and can ask for minutes separately. The parent's card says so and offers minutes explicitly.
- **Size:** 15, 30, 45 or 60 minutes past that night's scheduled bedtime. At most 60 per night; changing it replaces the amount, never adds to it.
- **Asking:**
  - A child may ask once per night ("Ask to stay up a little longer").
  - The ask is stored and child-scoped. Push is a best-effort heads-up.
  - Once the ask is pending, declined or fulfilled, a second one that night is refused, and the database enforces it.
  - Parents can always grant, change or cancel directly.
- **The authorized cutoff is the specific time the parent saw:**
  - Each choice is labelled with it: "10:23 PM tonight", or "Let Maya watch until 10:23 PM tonight" on Home.
  - It's stored as an absolute instant (`cutoff_at`).
  - If the recurring bedtime later moves earlier, tonight still runs to the authorized cutoff. If it moves later, the later bedtime wins.
- **Nights:**
  - A night is named by the evening's family-local date and ends at 04:00. The extension expires then by itself.
  - Bedtimes after midnight (for example 00:30) belong to the night before. This also fixes an old bug where such a bedtime blocked the whole evening.
  - Daylight saving: everything is in absolute instants. A nonexistent spring-forward time resolves to just after the gap; a repeated fall-back time resolves to its first occurrence.
- **Enforcement:**
  - **Server:** every kid page (layout), the player page, and `nextVideo` call `timeState()`.
  - **Player:**
    - stops at the effective cutoff using the wall clock, so a device that slept past it stops as soon as it wakes
    - shows "N minutes until bedtime" in the last five minutes
    - asks the server again every minute and whenever the screen wakes, so a cancellation applies mid-video
  - **Back to Home:** a full page load, so the server decides what shows next.
  - **No grace period** to finish the current video.
- **Multiple devices:** all state is on the server, per child. Every screen sees the same ask, the same answer and the same cutoff.

## Data (0023)
- **`bedtime_extensions`** has one live row per child per night (a unique index):
  - `night`
  - `base_bedtime`: the bedtime when granted
  - `extra_minutes`: 15/30/45/60
  - `cutoff_at`
  - `request_id`
  - `granted_by`
  - `cancelled_at`

  There's a family foreign key, RLS with select for the owner, and a check that the cutoff is within the night.
- **`time_requests`:**
  - gains kind `bedtime`, whose `day` is the night
  - a 45-minute grant is allowed only for bedtime
  - a unique index allows one bedtime ask per child per night, whatever its status
- **Rollback** (`0023_bedtime_extensions.down.sql`) drops extensions and bedtime asks, so children fall back to their scheduled bedtime (stricter), and restores 0022's checks.

## Screens
- **Child, at bedtime:**
  - "Time to rest, Maya"
  - the ask button, then a status line: "Sent! Waiting for a grown-up" / "A grown-up said not tonight". It's not a button, so on a TV nothing focusable appears actionable.
  - After an extension ends: "Your extra time is over. Videos come back tomorrow." No second ask.
- **Child, extended:** a quiet "Staying up until 10:23 PM" chip on Home (TV top bar, tablet chip, phone subtitle).
- **Parent:**
  - **Review card:** each choice shows its actual cutoff, plus Not tonight. When the minutes are also used up, it explains that and offers "Add 15/30/60 min today" separately.
  - **Home "Tonight" card:** the usual bedtime or "Maya can watch until … tonight (usual bedtime …)", with direct grant or change and "Cancel tonight's extension".

## Tests
- `bedtime.test.ts` (16): nights and the rollover, after-midnight bedtimes, time zones, DST gap and overlap, the cutoff staying put when bedtime changes, a later bedtime winning, expiry, cancellation, no bedtime, the cap, passed choices.
- `bedtime-extensions-db.test.ts` (6, PGlite): one live extension per child per night, the allowed steps, cutoff within the night, the family foreign key, one bedtime ask per night after denial, 45 only for bedtime, rollback.
- `bedtime-server.test.ts` (9, local store): what the server enforces, duplicate asks, stale answers, declined then granted directly, the daily-limit interaction in both directions, a changed recurring bedtime, cancellation, the cap, refusals.
- `time-requests.test.ts`: bedtime ask states and expiry after midnight.
- **Browser walkthroughs** (`kid-bedtime.cjs`, four fixtures, 38 checks):
  - the ask on TV with a phone open
  - parent approval with actual cutoffs
  - both screens extended
  - the recurring bedtime moved
  - cancellation stopping the player
  - declined then granted directly
  - minutes also used up
  - the five-minute warning
  - stopping after a simulated sleep/wake
  - the server refusing playback after bedtime
