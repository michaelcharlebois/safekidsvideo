# Watch-event accounting (audit and fix)

## What was wrong

**How the player recorded a finished video** (`watch/[id]/player.tsx`):
1. A start row when playback began.
2. On completion, a **second plain row** (`completed = true`, no outcome).
3. Then a `finished` end row.

**How the numbers counted it.** Stats, history, Home's "today", daily limits and check-ins all counted every row without an outcome as a play. So a finished video counted twice: about 60% of its length for the start, plus its full length for the completion row.
- **Example:** a 20-minute show counted as about 32 minutes, so daily limits tripped early.

**Other gaps found:**
- With skip limits off, moving to the next video recorded no end at all.
- Leaving with Back, or closing the app, recorded nothing.
- A video replayed on the same page wasn't recorded as a new play.
- Retried inserts could duplicate rows.
- Rows without a child were added to every child's totals, and their daily limits.

## The model now

**One viewing session = one start row + at most one end row**, sharing a `session_id` that the player creates (migration 0020).

**How sessions end:**

| How playback ends | Recorded as |
|---|---|
| The video ends, or Next, after at least 70% of it was actually played | `finished` |
| Next with less than 70% played, or reaching the end by seeking ahead | `skipped` |
| Home, Back, closing the app | `left` |
| No end recorded (power cut, crash) | `unknown` |

The 70% rule is the skip budget's own (`leavingOutcome` / `leavingCounts` in `skip-ledger.ts`), so a row never says "finished" while the budget charged a skip. Local mode now records sessions too (the local store), so limits and Activity work offline.

**What the player and database guarantee:**
- Resuming after a pause is the same session. Playing a video again is a new session.
- The database stores at most one start and one end per session (unique indexes), so retries can't double-count. This was checked with parallel retries on real Postgres.

**One interpreter.** `src/lib/sessions.ts` is the only code that turns rows into plays. Activity (time, history, patterns), Home's "today", daily limits and the evening check-in all use it.

**Seconds per session:**

**Playback time vs position.** Each end row carries both `ended_at_sec` (where the playhead was) and `watched_sec` (seconds actually played in the session: pauses, buffering and seeks don't count; watching a part again does). The player measures it with `src/lib/playback.ts`. Jumping to the end therefore doesn't count as watching the whole video, and rewinding counts the extra viewing.

| Outcome | Seconds counted |
|---|---|
| Any end row with `watched_sec` (this branch's player) | `watched_sec`, capped at 6 hours |
| Finished, older rows | The video's length |
| Skipped or left, older rows | The reported position, capped at the length |
| Unknown | 60% of the length, at least 2 minutes, never more than the length |

Skips and the player's own screen-time countdown use the same playing time. Closing the app sends the end row by `navigator.sendBeacon` to `/api/watch/end`, so "left" is recorded more often than before; a session that still ends with no row is "unknown".

A video with no known length counts as 5 minutes. Minutes are rounded once per total, not per play.

**Out of order and missing rows:**
- An end row arriving before its start, duplicate starts or ends, and an end whose start was lost are all handled. The first end row wins.

**Child attribution:**
- Viewing is recorded only for a known child. The server refuses a row without one.
- Old rows without a child count for that child in a one-child family.
- In a family with several children, they count for no child. Activity shows how many there were.

## Historical rows (no migration of data needed)

Older rows have no `session_id`. They're folded the same way:
- a completion row right after a start of the same video (same child) marks that session finished
- an end row attaches to the latest unfinished session of that video within its length + 15 minutes
- a start written just after its own end (racing inserts) joins that session

Nothing is rewritten, so the change is reversible.

`scripts/staging/watch-events-audit.sql` is read-only. It reports:
- rows by shape
- how many old completion rows were extra plays
- unattributed rows in families with several children

Run it on staging before and after 0020.

## Migration 0020: status and order

**Status: not applied anywhere.** It must stay unapplied on production until the release is approved.

**What it does:** adds nullable `session_id` and `watched_sec` (0 to 21600, checked), two partial unique indexes (one start and one end per session) and a per-child time index. It's additive. The rollback is `supabase/rollbacks/0020_watch_sessions.down.sql`.

**Order matters:**
1. **0020 must precede any build that writes watch sessions** (this branch's player). That build writes `session_id`. Against a database without the column, every new viewing record is rejected. The error is logged and the record dropped, so playback works but viewing time and daily limits under-count.
2. Older builds are unaffected by 0020, so it can go in first.
3. **Release sequence:** rehearse on staging (`scripts/staging-db-check.sh`, then `scripts/staging/watch-events-audit.sql` before and after) → apply 0020 (and 0021) to production → deploy the build.

**0021** makes requests per child (one pending request per child per video, instead of per family). It isn't applied either. Apply it with 0020, before deploying.

## Tests

| Test file | Covers |
|---|---|
| `test/sessions.test.ts` | Completed, skipped, abandoned and repeated plays; duplicates, delays, out-of-order rows, a lost start; the old double row; the demo seeder's shape; per-child separation; attribution |
| `test/viewing-numbers.test.ts` | Screen-time limit regression (a finished show counts once); repeated plays reaching a limit; yesterday excluded; stats and check-in agree with the limit; unattributed in multi-child families |
| `test/history.test.ts` | History on sessions |
| `test/watch-sessions-db.test.ts` | PGlite: one start and one end per session, older rows untouched, clean rollback. Real Postgres 16: 12 parallel retries store one of each |

`scripts/staging-db-check.sh` passes 30 of 30.
