-- 0022: "Ask a grown-up for more time" becomes a stored request, not just a push notification.
--
-- Before: the kid's tap sent a push to the family's phones and the kid saw "Sent!". With no push
-- subscription nothing reached anyone; a second screen could ask again; the parent had nothing to act on.
-- Now: one row per ask. At most ONE pending request per child per kind per family-local day, across all
-- screens (unique index). The parent answers it in Review (approve with +15/+30/+60 minutes, or decline);
-- push is only a heads-up. Nothing here grants time: only a parent's approval adds bonus minutes.
--
-- kind: 'limit' (the daily minutes ran out). Bedtime is a separate restriction; a bedtime extension is a
-- proposal awaiting approval and is NOT part of this migration.
-- A pending request for an earlier day is expired: the app ignores it (no job needed).
--
-- Additive (a new table). Not applied anywhere yet. Apply with 0018–0021, before the build that uses it.
-- Rollback: supabase/rollbacks/0022_time_requests.down.sql

create table if not exists time_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families (id) on delete cascade,
  profile_id uuid not null,
  kind text not null default 'limit' check (kind in ('limit')),
  day date not null,                                   -- the family-local day the request is for
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  granted_minutes integer check (granted_minutes in (15, 30, 60)),
  device_id uuid references devices (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint time_requests_profile_family_fk foreign key (profile_id, family_id) references profiles (id, family_id) on delete cascade,
  constraint time_requests_grant_matches_status check ((status = 'approved') = (granted_minutes is not null)),
  constraint time_requests_resolved_matches_status check ((status = 'pending') = (resolved_at is null))
);

-- One pending ask per child, kind and day, whichever screen it came from.
create unique index if not exists time_requests_one_pending_uq
  on time_requests (profile_id, kind, day) where status = 'pending';
-- The parent's inbox: a family's requests for a day.
create index if not exists time_requests_family_day_idx on time_requests (family_id, day desc, status);

alter table time_requests enable row level security;
create policy "own time requests" on time_requests for select
  using (family_id in (select id from families where owner_user_id = auth.uid()));
