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
| The video plays to the end | `finished` |
| Next / skip, with or without skip limits | `skipped` |
| Home, Back, closing the app | `left` |
| No end recorded (power cut, crash) | `unknown` |

**What the player and database guarantee:**
- Resuming after a pause is the same session. Playing a video again is a new session.
- The database stores at most one start and one end per session (unique indexes), so retries can't double-count. This was checked with parallel retries on real Postgres.

**One interpreter.** `src/lib/sessions.ts` is the only code that turns rows into plays. Activity (time, history, patterns), Home's "today", daily limits and the evening check-in all use it.

**Seconds per session:**

| Outcome | Seconds counted |
|---|---|
| Finished | The video's length |
| Skipped or left | The reported position, capped at the length |
| Unknown | 60% of the length, at least 2 minutes, never more than the length |

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

## Migration 0020 (not applied)

- Adds nullable `session_id`, two partial unique indexes and a per-child time index.
- Additive. Rollback is in `supabase/rollbacks/0020_watch_sessions.down.sql`.
- **Deploy order:** apply 0020 before (or with) the app. Otherwise new rows fail on the missing column, and are logged and dropped rather than breaking playback.

## Tests

| Test file | Covers |
|---|---|
| `test/sessions.test.ts` | Completed, skipped, abandoned and repeated plays; duplicates, delays, out-of-order rows, a lost start; the old double row; the demo seeder's shape; per-child separation; attribution |
| `test/viewing-numbers.test.ts` | Screen-time limit regression (a finished show counts once); repeated plays reaching a limit; yesterday excluded; stats and check-in agree with the limit; unattributed in multi-child families |
| `test/history.test.ts` | History on sessions |
| `test/watch-sessions-db.test.ts` | PGlite: one start and one end per session, older rows untouched, clean rollback. Real Postgres 16: 12 parallel retries store one of each |

`scripts/staging-db-check.sh` passes 30 of 30.
