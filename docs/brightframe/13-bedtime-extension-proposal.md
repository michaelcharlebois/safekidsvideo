# Proposal: a one-night bedtime extension (for approval — not implemented)

## The problem
`timeState()` checks bedtime ("done for the day") before the daily limit, and bonus minutes only raise the daily limit. So "+15 minutes" granted at 7:40 pm, after a 7:30 bedtime, changes nothing: the child still sees "Time to rest". Until now the bedtime screen still offered "Ask a grown-up for more time", which promised something a parent couldn't deliver.

**Already changed in this round (no new permission):**
- The bedtime screen no longer offers to ask for more time. It says videos are done for today and come back tomorrow.
- Extra minutes still never lift bedtime. That behaviour is unchanged.
- The daily-limit screen keeps its Ask button, now as a stored request (see `14-staging-readiness.md`).

## Proposed semantics

**What it is.** A parent can let one child stay up later **tonight only**, by 15, 30, 45 or 60 minutes past that child's bedtime. The recurring bedtime setting isn't touched.

**What it isn't:**
- It doesn't add daily minutes. If the daily limit runs out during the extension, the daily-limit screen shows (and the child can ask for minutes, as today).
- Bonus minutes still don't lift bedtime.
- It's never automatic, and never granted by the child or a device: only a signed-in parent (or the parent PIN area in local mode) grants it.

**When it applies.**
- Bedtime currently runs from the bedtime until 4:00 am, in the family's time zone.
- A *night* is the evening's date: from 4:00 am on day D until 4:00 am on day D+1 is night D.
- An extension for night D moves that night's start from `bedtime` to `bedtime + N minutes`.
  - It's capped so the start never passes 3:59 am.
  - Bedtimes after midnight (such as 00:30) are handled in minutes since 4:00 am, so there's no wrap-around bug.

**Expiry.** It expires on its own at 4:00 am, when the night changes. No job is needed; an extension for an earlier night simply doesn't match.

**Several grants in one night.** One extension per child per night. Granting again replaces the amount, for example 15 → 30. The total is capped at 60 minutes.

**Relative, not absolute.** The extension is stored as minutes past bedtime. If a parent changes tonight's bedtime after granting, the extension follows the new bedtime. Parent screens always show the resulting time ("Tonight: until 8:00 pm").

**Cancelling.** A parent can cancel tonight's extension. It takes effect at the child's next server check (page load, next video) and in the player at once, as below.

## Data model (new migration, 0023, not written yet)
```sql
create table bedtime_extensions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families (id) on delete cascade,
  profile_id uuid not null,
  night date not null,                         -- the evening's family-local date
  extra_minutes integer not null check (extra_minutes in (15, 30, 45, 60)),
  granted_by uuid,                             -- auth user id (null in local mode)
  request_id uuid references time_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  foreign key (profile_id, family_id) references profiles (id, family_id) on delete cascade
);
create unique index bedtime_extensions_one_per_night on bedtime_extensions (profile_id, night) where cancelled_at is null;
```

**Kid requests.** `time_requests.kind` gains `'bedtime'` in the same migration. It reuses the stored-request flow just built:
- one pending ask per child per night
- answered in Review
- push only as a heads-up

**Why a table and not profile columns** (like `bonusMinutes`):
- It keeps an audit trail of who allowed what and when.
- It links to the request that prompted it.
- It can't leak into the next night.

## Parent controls
- **Review:** a bedtime ask shows "Maya is asking to stay up a bit later tonight (bedtime 7:30 pm)", with +15 / +30 / +60 and Not tonight.
- **Child settings → Screen time:** "Tonight only: stay up until…" with +15 / +30 / +45 / +60 and Cancel tonight's extension. The recurring bedtime field is separate and unchanged.
- **Parent Home:** "Bedtime tonight 7:30 → 8:00 (extended)" while an extension is active.

## Kid experience
- **Bedtime screen:** "Time to rest, Maya", with "Ask a grown-up to stay up a little longer" (once per night).
  - The ask shows the stored state: Waiting for a grown-up, or "A grown-up said not tonight".
  - It refreshes on its own while waiting.
- **When granted:** the screen returns to Home with a quiet "Until 8:00 pm" chip. At five minutes before the end, the player shows "5 minutes until bedtime".
- **Player at the boundary:**
  - Today the player only enforces the daily-limit countdown. A bedtime reached mid-video is only enforced at the next video.
  - Proposed: the player also receives tonight's effective bedtime and stops there, ending the session as "left". That covers both the normal bedtime and the end of an extension.
  - Option for you: let the current video finish if it ends within 5 minutes of the boundary.

## Edge cases
| Case | Behaviour |
|---|---|
| Daily limit runs out during an extension | Daily-limit screen (can ask for minutes). The extension still bounds the night |
| Minutes approved after bedtime started | Minutes are added for today. Bedtime still applies; the Review card says so ("bedtime starts 7:30 pm") |
| Bedtime turned off tonight | Extension ignored (nothing to extend) |
| Granted after 4:00 am for "last night" | Refused: that night is over |
| Time-zone change or DST night | Family-local wall clock, as bedtime is today. On a fall-back night the window may run an hour longer in real time; accepted, and documented |
| Two screens | Server-side, per child: every screen sees the same state at its next check |
| Switching to a sibling | Each child has their own bedtime and extension; switching still needs the PIN |
| Parent cancels | Takes effect at the next check; the player re-checks at the boundary |

## Questions for you
1. Steps of 15 / 30 / 45 / 60, capped at 60 per night, OK?
2. Should the kid be able to ask for a bedtime extension at all, or should parents only grant it from Settings?
3. At the boundary mid-video: stop at once, or let a video that ends within 5 minutes finish?
4. One ask per night, even after an approved extension runs out?
