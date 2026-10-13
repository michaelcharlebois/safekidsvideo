-- 0018 — Child-scoped permissions.
--
-- What this does (and the rules it follows — see docs/brightframe/02-child-scope.md):
--   1. Snapshots the current whitelist to whitelist_pre_0018 so the change is reversible
--      (0018_child_scope.down.sql restores it exactly).
--   2. Adds whitelist.profile_id (null = every child in the family) with a composite FK so a
--      child-specific row can only name a child of the SAME family, and a NULLS NOT DISTINCT
--      unique key so family-wide and child-specific rows upsert/dedupe correctly.
--   3. Re-scopes legacy family-wide 'override' and 'auto' rows. A row is attributed to a child ONLY when
--      that is reliable:
--        - the family has exactly one child, or
--        - override: every approved request for that video in that family came from one (non-null) child;
--        - auto: every passing check for that video in that family came from one (non-null) child.
--      Everything else moves to legacy_grants for a parent to re-assign and grants NOTHING meanwhile.
--      'block' and 'dismissed' stay family-wide (restrictive, so safe). 'channel'/'video' stay family-wide.
--   4. Requires a child on 'override'/'auto' from now on.
--   5. Adds composite child→family FKs to every child-specific table (requests, checks, watch history,
--      check-ins), and device→child binding (assigned child; active child on shared screens; PIN lockout).
--   6. Fills missing child ages from the family's legacy age so the age gate never silently fails open.

begin;

-- 1. snapshot ---------------------------------------------------------------------------------
create table if not exists whitelist_pre_0018 as select family_id, kind, target_id, created_at from whitelist;
alter table whitelist_pre_0018 enable row level security; -- service role only

-- children carry (id, family_id) so other tables can reference both
alter table profiles add constraint profiles_id_family_key unique (id, family_id);
update profiles p set age = coalesce(p.age, f.kid_age, 6) from families f where p.family_id = f.id and p.age is null;

-- 2. whitelist structure ------------------------------------------------------------------------
alter table whitelist add column if not exists id uuid not null default gen_random_uuid();
alter table whitelist add column if not exists profile_id uuid;
alter table whitelist drop constraint if exists whitelist_pkey;
alter table whitelist add constraint whitelist_pkey primary key (id);
alter table whitelist add constraint whitelist_profile_family_fk
  foreign key (profile_id, family_id) references profiles (id, family_id) on delete cascade;
alter table whitelist add constraint whitelist_scope_key unique nulls not distinct (family_id, kind, target_id, profile_id);
create index if not exists whitelist_family_profile_idx on whitelist (family_id, profile_id);

-- 3. legacy re-scoping --------------------------------------------------------------------------
create table if not exists legacy_grants (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  kind text not null check (kind in ('override','auto')),
  target_id text not null,
  created_at timestamptz not null,
  candidate_profile_ids uuid[] not null default '{}',
  resolved_at timestamptz,
  resolution text,                       -- 'allowed:<profile_id>' | 'dismissed'
  unique (family_id, kind, target_id)
);
alter table legacy_grants enable row level security;
create policy "own legacy grants" on legacy_grants for all
  using (family_id in (select id from families where owner_user_id = auth.uid()))
  with check (family_id in (select id from families where owner_user_id = auth.uid()));

create temp table _legacy_attrib on commit drop as
select
  w.family_id, w.kind, w.target_id, w.created_at,
  case
    when (select count(*) from profiles p where p.family_id = w.family_id) = 1
      then (select p.id from profiles p where p.family_id = w.family_id)
    when w.kind = 'override' then (
      select case when count(*) > 0 and count(*) = count(r.profile_id) and count(distinct r.profile_id) = 1
                  then (min(r.profile_id::text))::uuid end
      from watch_requests r
      where r.family_id = w.family_id and r.video_id = w.target_id and r.status = 'approved')
    when w.kind = 'auto' then (
      select case when count(*) > 0 and count(*) = count(c.profile_id) and count(distinct c.profile_id) = 1
                  then (min(c.profile_id::text))::uuid end
      from kid_checks c
      where c.family_id = w.family_id and c.video_id = w.target_id and c.outcome = 'passed')
  end as profile_id,
  -- for the parent's re-assignment list: children who touched this video, else every child in the family
  coalesce(
    nullif(array(
      select distinct x.pid from (
        select r.profile_id as pid from watch_requests r where r.family_id = w.family_id and r.video_id = w.target_id and r.profile_id is not null
        union
        select c.profile_id from kid_checks c where c.family_id = w.family_id and c.video_id = w.target_id and c.profile_id is not null
      ) x), '{}'),
    array(select p.id from profiles p where p.family_id = w.family_id order by p.sort, p.created_at)
  ) as candidates
from whitelist w
where w.kind in ('override','auto') and w.profile_id is null;

insert into whitelist (family_id, kind, target_id, profile_id, created_at)
select family_id, kind, target_id, profile_id, created_at from _legacy_attrib where profile_id is not null
on conflict do nothing;

insert into legacy_grants (family_id, kind, target_id, created_at, candidate_profile_ids)
select family_id, kind, target_id, created_at, candidates from _legacy_attrib where profile_id is null
on conflict do nothing;

delete from whitelist where kind in ('override','auto') and profile_id is null;

-- 4. from now on, explicit approvals and open-mode clearances always name a child
alter table whitelist add constraint whitelist_child_kinds check (kind not in ('override','auto') or profile_id is not null);

-- 5. child-specific records belong to the same family -------------------------------------------
alter table watch_events add constraint watch_events_profile_family_fk
  foreign key (profile_id, family_id) references profiles (id, family_id) on delete set null (profile_id);
alter table kid_checks add constraint kid_checks_profile_family_fk
  foreign key (profile_id, family_id) references profiles (id, family_id) on delete set null (profile_id);
alter table watch_requests add constraint watch_requests_profile_family_fk
  foreign key (profile_id, family_id) references profiles (id, family_id) on delete set null (profile_id);
alter table kid_days add constraint kid_days_profile_family_fk
  foreign key (profile_id, family_id) references profiles (id, family_id) on delete cascade;

alter table devices add column if not exists assigned_profile_id uuid;   -- personal device: always this child
alter table devices add column if not exists active_profile_id uuid;     -- shared device: child picked with the PIN
alter table devices add column if not exists pin_failures int not null default 0;
alter table devices add column if not exists pin_locked_until timestamptz;
alter table devices add constraint devices_assigned_profile_fk
  foreign key (assigned_profile_id, family_id) references profiles (id, family_id) on delete set null (assigned_profile_id);
alter table devices add constraint devices_active_profile_fk
  foreign key (active_profile_id, family_id) references profiles (id, family_id) on delete set null (active_profile_id);

commit;
