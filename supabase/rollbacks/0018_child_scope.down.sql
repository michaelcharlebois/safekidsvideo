-- Reverses 0018_child_scope.sql. Run by hand in the SQL editor ONLY to roll back.
-- Restores the whitelist exactly as it was before 0018 (from whitelist_pre_0018). Any approvals,
-- blocks or channel changes made after 0018 are discarded, as are legacy_grants decisions and
-- device→child assignments. The app code on feature/brightframe expects 0018; deploy the matching
-- code version before/after rolling back.

begin;

alter table devices drop constraint if exists devices_active_profile_fk;
alter table devices drop constraint if exists devices_assigned_profile_fk;
alter table devices drop column if exists pin_locked_until;
alter table devices drop column if exists pin_failures;
alter table devices drop column if exists active_profile_id;
alter table devices drop column if exists assigned_profile_id;

alter table kid_days drop constraint if exists kid_days_profile_family_fk;
alter table watch_requests drop constraint if exists watch_requests_profile_family_fk;
alter table kid_checks drop constraint if exists kid_checks_profile_family_fk;
alter table watch_events drop constraint if exists watch_events_profile_family_fk;

drop table if exists legacy_grants;

alter table whitelist drop constraint if exists whitelist_child_kinds;
alter table whitelist drop constraint if exists whitelist_scope_key;
alter table whitelist drop constraint if exists whitelist_profile_family_fk;
alter table whitelist drop constraint if exists whitelist_pkey;
drop index if exists whitelist_family_profile_idx;
delete from whitelist;
alter table whitelist drop column if exists profile_id;
alter table whitelist drop column if exists id;
insert into whitelist (family_id, kind, target_id, created_at)
  select family_id, kind, target_id, created_at from whitelist_pre_0018;
alter table whitelist add constraint whitelist_pkey primary key (family_id, kind, target_id);

alter table profiles drop constraint if exists profiles_id_family_key;
drop table if exists whitelist_pre_0018;

commit;
