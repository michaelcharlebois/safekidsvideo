-- 0020: one viewing session = one start row + at most one end row.
--
-- Before: the player wrote a start row when playback began, then on completion a second plain row
-- (completed = true, no outcome) AND a "finished" end row, so a finished video could count as two plays.
-- Retried inserts could also duplicate rows.
--
-- Now each playback gets a session_id (made by the player). Its start row (outcome is null) and its end
-- row (outcome is not null) are unique per session, so a retry is ignored instead of double-counting.
-- Older rows keep session_id null; the app folds them into sessions (src/lib/sessions.ts). Nothing here
-- rewrites history.
--
-- ORDER: apply this BEFORE deploying any build that writes watch sessions (this branch). That build writes
-- session_id; without this column every new viewing record is rejected (logged and dropped, so viewing
-- time and limits would under-count). Additive: older builds are unaffected by it.
-- STATUS: not applied anywhere. Keep it unapplied on production until the release is approved; rehearse on
-- staging first (scripts/staging-db-check.sh, scripts/staging/watch-events-audit.sql).
-- Rollback: supabase/rollbacks/0020_watch_sessions.down.sql

alter table watch_events add column if not exists session_id uuid;

create unique index if not exists watch_events_session_start_uq
  on watch_events (session_id) where session_id is not null and outcome is null;
create unique index if not exists watch_events_session_end_uq
  on watch_events (session_id) where session_id is not null and outcome is not null;

-- Viewing is read per child and day (Activity, limits, check-ins).
create index if not exists watch_events_family_profile_time_idx on watch_events (family_id, profile_id, started_at desc);
