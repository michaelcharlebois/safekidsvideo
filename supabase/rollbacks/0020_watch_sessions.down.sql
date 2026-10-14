-- Rollback for 0020. The app keeps working without session_id (it folds rows into sessions either way),
-- but new writes would then fail on the missing column: roll the app back first.
drop index if exists watch_events_family_profile_time_idx;
drop index if exists watch_events_session_end_uq;
drop index if exists watch_events_session_start_uq;
alter table watch_events drop column if exists session_id;
