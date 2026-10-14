-- Reverses 0018_child_scope.sql. Part of the coordinated rollback in docs/brightframe/14 (permission
-- writes paused, the previous build deployed, then 0023 → 0018 rolled back in order). Run by hand.
--
-- The previous build only understands family-wide permissions, so the whitelist goes back to its pre-0018
-- shape, and the rule is that the rollback NEVER WIDENS what any child can watch compared with now:
--   - pre-0018 rows come back as they were, EXCEPT allows a parent took away after 0018: a channel or added
--     video removed, an old approval undone, an old record dismissed ("Don't allow");
--   - restrictions added after 0018 (a block / Never, or Keep hidden, for any child) come back family-wide —
--     stricter for everyone, never looser;
--   - allows created after 0018 (always for one child) can't be expressed family-wide without widening, so
--     they are dropped and listed in rollback_0018_report for a parent to redo after the old build is back.
-- With no permission changes since 0018, the result is exactly the pre-0018 whitelist.
-- Device→child assignments and PIN-lockout state are dropped (the previous build doesn't use them).

begin;

create temp table _restore on commit drop as
select family_id, kind, target_id, min(created_at) as created_at from (
  select s.family_id, s.kind, s.target_id, s.created_at from whitelist_pre_0018 s
  where case
    when s.kind in ('block', 'dismissed') then true
    when s.kind in ('channel', 'video') then exists (select 1 from whitelist w where w.family_id = s.family_id and w.kind = s.kind and w.target_id = s.target_id and w.profile_id is null)
    when s.kind in ('override', 'auto') then
      exists (select 1 from whitelist w where w.family_id = s.family_id and w.kind = s.kind and w.target_id = s.target_id and w.profile_id is not null)
      or exists (select 1 from legacy_grants g where g.family_id = s.family_id and g.kind = s.kind and g.target_id = s.target_id and g.resolved_at is null)
    else false end
  union all
  select w.family_id, w.kind, w.target_id, w.created_at from whitelist w where w.kind in ('block', 'dismissed')
) x group by family_id, kind, target_id;

create table if not exists rollback_0018_report (
  family_id uuid, kind text, target_id text, profile_id uuid, created_at timestamptz, note text, reported_at timestamptz default now()
);
insert into rollback_0018_report (family_id, kind, target_id, profile_id, created_at, note)
select w.family_id, w.kind, w.target_id, w.profile_id, w.created_at, 'allow made after 0018: not restored (redo for this child)'
  from whitelist w
 where w.kind not in ('block', 'dismissed')
   and not exists (select 1 from _restore r where r.family_id = w.family_id and r.kind = w.kind and r.target_id = w.target_id)
union all
select s.family_id, s.kind, s.target_id, null, s.created_at, 'pre-0018 allow a parent removed after 0018: not restored'
  from whitelist_pre_0018 s
 where not exists (select 1 from _restore r where r.family_id = s.family_id and r.kind = s.kind and r.target_id = s.target_id);

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
  select family_id, kind, target_id, created_at from _restore;
alter table whitelist add constraint whitelist_pkey primary key (family_id, kind, target_id);

alter table profiles drop constraint if exists profiles_id_family_key;
drop index if exists watch_requests_family_video_idx;
drop index if exists kid_checks_family_video_idx;
drop index if exists profiles_family_idx;
drop table if exists whitelist_pre_0018;

commit;
