-- Rollback for 0023. Roll the app back first (the build that uses extensions needs this table).
-- Drops tonight's extensions and bedtime asks: the child falls back to the scheduled bedtime (stricter).
drop function if exists grant_minutes(uuid, uuid, int, date);
drop function if exists approve_minutes_request(uuid, uuid, int, date);
drop function if exists grant_bedtime_extension(uuid, uuid, date, text, int, timestamptz, uuid);
drop function if exists approve_bedtime_request(uuid, uuid, int, timestamptz, text, date);
drop index if exists time_requests_one_bedtime_ask_uq;
delete from time_requests where kind = 'bedtime';
alter table time_requests drop constraint if exists time_requests_granted_minutes_check;
alter table time_requests add constraint time_requests_granted_minutes_check check (granted_minutes in (15, 30, 60));
alter table time_requests drop constraint if exists time_requests_kind_check;
alter table time_requests add constraint time_requests_kind_check check (kind in ('limit'));
drop table if exists bedtime_extensions;
