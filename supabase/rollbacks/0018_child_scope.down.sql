-- Reverses 0018_child_scope.sql. Part of the coordinated rollback in docs/brightframe/14 (permission
-- writes paused, the previous build deployed, then 0023 → 0018 rolled back in order). Run by hand.
--
-- The previous build only understands family-wide permissions: a row there applies to EVERY child in the
-- family. So the rule is that the rollback never lets any child watch something they couldn't watch
-- immediately before it ran:
--   - an allow (channel, added video, approval, open-mode clearance) comes back family-wide only if every
--     child in the family has it right now (through a family-wide row, or a row for each child). An allow
--     only some children have — "Maya's approval", a held old record that grants nobody, one undone for
--     one child — is dropped and listed in rollback_0018_report for a parent to restore by hand;
--   - restrictions (block / Never, Keep hidden) — from before 0018 or added since, for any child — come back
--     family-wide: stricter for everyone, never looser.
-- Device→child assignments and PIN-lockout state are dropped (the previous build doesn't use them).

begin;

create temp table _children on commit drop as
select family_id, count(*)::int as n from profiles group by family_id;

create temp table _restore on commit drop as
select family_id, kind, target_id, min(created_at) as created_at from (
  -- allows every child has now: a family-wide row …
  select w.family_id, w.kind, w.target_id, w.created_at
    from whitelist w
   where w.kind in ('channel', 'video') and w.profile_id is null
  union all
  -- … or a row for each child of the family (at least one child)
  select w.family_id, w.kind, w.target_id, min(w.created_at)
    from whitelist w join _children c on c.family_id = w.family_id
   where w.kind in ('channel', 'video', 'override', 'auto') and w.profile_id is not null
   group by w.family_id, w.kind, w.target_id, c.n
  having count(distinct w.profile_id) = c.n
  union all
  -- restrictions, from before 0018 or since, for anyone: family-wide
  select s.family_id, s.kind, s.target_id, s.created_at from whitelist_pre_0018 s where s.kind in ('block', 'dismissed')
  union all
  select w.family_id, w.kind, w.target_id, w.created_at from whitelist w where w.kind in ('block', 'dismissed')
) x group by family_id, kind, target_id;

create table if not exists rollback_0018_report (
  family_id uuid, kind text, target_id text, profile_id uuid, created_at timestamptz, note text, reported_at timestamptz default now()
);
insert into rollback_0018_report (family_id, kind, target_id, profile_id, created_at, note)
select w.family_id, w.kind, w.target_id, w.profile_id, w.created_at, 'allowed for only some children: not restored (restore by hand for this child)'
  from whitelist w
 where w.kind in ('channel', 'video', 'override', 'auto')
   and not exists (select 1 from _restore r where r.family_id = w.family_id and r.kind = w.kind and r.target_id = w.target_id)
union all
select g.family_id, g.kind, g.target_id, null, g.created_at, 'old approval held for review (granting nobody): not restored'
  from legacy_grants g
 where g.resolved_at is null
   and not exists (select 1 from _restore r where r.family_id = g.family_id and r.kind = g.kind and r.target_id = g.target_id)
union all
select s.family_id, s.kind, s.target_id, null, s.created_at, 'pre-0018 allow no child has any more: not restored'
  from whitelist_pre_0018 s
 where s.kind in ('channel', 'video', 'override', 'auto')
   and not exists (select 1 from _restore r where r.family_id = s.family_id and r.kind = s.kind and r.target_id = s.target_id)
   and not exists (select 1 from whitelist w where w.family_id = s.family_id and w.kind = s.kind and w.target_id = s.target_id)
   and not exists (select 1 from legacy_grants g where g.family_id = s.family_id and g.kind = s.kind and g.target_id = s.target_id and g.resolved_at is null);

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
