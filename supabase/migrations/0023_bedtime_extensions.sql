-- 0023: a one-night bedtime extension per child, and bedtime asks.
--
-- Bedtime ("done for the day") is separate from daily minutes: extra minutes never lift it, and an
-- extension never adds minutes. A parent can let one child watch until a specific later time TONIGHT:
-- 15, 30, 45 or 60 minutes past that night's scheduled bedtime. The row stores the cutoff the parent
-- authorized (cutoff_at). If the recurring bedtime changes later, tonight's bedtime starts at the later of
-- the new scheduled time and that cutoff; the cutoff itself is never moved. A night is named by the
-- evening's family-local date and ends at 04:00 the next morning, when the extension simply stops matching.
--
-- A child may ask for one extension per night (time_requests kind 'bedtime', day = the night). Once it's
-- pending, declined or fulfilled, a second ask that night is refused by the database. Parents can still
-- grant, change or cancel an extension directly.
--
-- Not applied anywhere yet. Apply after 0022, before the build that uses it.
-- Rollback: supabase/rollbacks/0023_bedtime_extensions.down.sql

create table if not exists bedtime_extensions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families (id) on delete cascade,
  profile_id uuid not null,
  night date not null,
  base_bedtime text not null check (base_bedtime ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  extra_minutes integer not null check (extra_minutes in (15, 30, 45, 60)),
  cutoff_at timestamptz not null,
  request_id uuid references time_requests (id) on delete set null,
  granted_by uuid,                                   -- auth user who granted it (null in local mode)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint bedtime_extensions_profile_family_fk foreign key (profile_id, family_id) references profiles (id, family_id) on delete cascade,
  -- the cutoff is within the night: after its evening began and before the 04:00 rollover (± a day for time zones)
  constraint bedtime_extensions_cutoff_in_night check (cutoff_at > night::timestamptz - interval '1 day' and cutoff_at < night::timestamptz + interval '2 days')
);
-- At most one live extension per child per night (changing it updates the row; cancelling frees the slot).
create unique index if not exists bedtime_extensions_one_live_uq on bedtime_extensions (profile_id, night) where cancelled_at is null;
create index if not exists bedtime_extensions_family_night_idx on bedtime_extensions (family_id, night desc);
alter table bedtime_extensions enable row level security;
create policy "own bedtime extensions" on bedtime_extensions for select
  using (family_id in (select id from families where owner_user_id = auth.uid()));

-- Bedtime asks share the stored-request flow (0022).
alter table time_requests drop constraint if exists time_requests_kind_check;
alter table time_requests add constraint time_requests_kind_check check (kind in ('limit', 'bedtime'));
alter table time_requests drop constraint if exists time_requests_granted_minutes_check;
alter table time_requests add constraint time_requests_granted_minutes_check
  check (granted_minutes in (15, 30, 45, 60) and (kind = 'bedtime' or granted_minutes <> 45));
-- One bedtime ask per child per night, whatever became of it.
create unique index if not exists time_requests_one_bedtime_ask_uq on time_requests (profile_id, day) where kind = 'bedtime';

-- Answering an ask and granting what it asks for happen in ONE transaction, so an approved ask always has
-- its grant and a failure leaves the ask pending (nothing reported as granted). The ask row is locked, so
-- of two simultaneous answers exactly one wins; a retry finds it answered ('gone'). Server-only.

-- Bedtime: approve tonight's ask and set tonight's extension (replacing any live one for that night).
create or replace function approve_bedtime_request(p_family uuid, p_request uuid, p_minutes int, p_cutoff timestamptz, p_base text, p_night date)
returns text language plpgsql security definer set search_path = public as $$
declare r time_requests%rowtype;
begin
  select * into r from time_requests where id = p_request and family_id = p_family for update;
  if not found or r.kind <> 'bedtime' or r.status <> 'pending' then return 'gone'; end if;
  if r.day <> p_night then return 'expired'; end if;
  perform 1 from profiles where id = r.profile_id and family_id = p_family for update;
  insert into bedtime_extensions (family_id, profile_id, night, base_bedtime, extra_minutes, cutoff_at, request_id)
    values (p_family, r.profile_id, p_night, p_base, p_minutes, p_cutoff, r.id)
    on conflict (profile_id, night) where cancelled_at is null
    do update set base_bedtime = excluded.base_bedtime, extra_minutes = excluded.extra_minutes, cutoff_at = excluded.cutoff_at,
                  request_id = excluded.request_id, updated_at = now();
  update time_requests set status = 'approved', granted_minutes = p_minutes, resolved_at = now() where id = r.id;
  return 'done';
end $$;

-- Bedtime, granted directly by a parent: set tonight's extension and answer tonight's pending ask with it.
create or replace function grant_bedtime_extension(p_family uuid, p_profile uuid, p_night date, p_base text, p_minutes int, p_cutoff timestamptz, p_granted_by uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare ext_id uuid;
begin
  -- Lock order everywhere: the child's pending ask(s) → the child's profile → the extension. Approvals take
  -- the same order, so a direct grant racing an approval waits instead of deadlocking.
  perform 1 from time_requests where profile_id = p_profile and family_id = p_family and kind = 'bedtime' and day = p_night and status = 'pending' for update;
  perform 1 from profiles where id = p_profile and family_id = p_family for update;
  if not found then raise exception 'not a child of this family'; end if;
  insert into bedtime_extensions (family_id, profile_id, night, base_bedtime, extra_minutes, cutoff_at, granted_by)
    values (p_family, p_profile, p_night, p_base, p_minutes, p_cutoff, p_granted_by)
    on conflict (profile_id, night) where cancelled_at is null
    do update set base_bedtime = excluded.base_bedtime, extra_minutes = excluded.extra_minutes, cutoff_at = excluded.cutoff_at,
                  granted_by = excluded.granted_by, updated_at = now()
    returning id into ext_id;
  update time_requests set status = 'approved', granted_minutes = p_minutes, resolved_at = now()
   where profile_id = p_profile and family_id = p_family and kind = 'bedtime' and day = p_night and status = 'pending';
  return ext_id;
end $$;

-- Daily minutes: approve today's ask and add the minutes for today (p_today = the family-local date).
create or replace function approve_minutes_request(p_family uuid, p_request uuid, p_minutes int, p_today date)
returns text language plpgsql security definer set search_path = public as $$
declare r time_requests%rowtype;
begin
  select * into r from time_requests where id = p_request and family_id = p_family for update;
  if not found or r.kind <> 'limit' or r.status <> 'pending' then return 'gone'; end if;
  if r.day <> p_today then return 'expired'; end if;
  update profiles set bonus_minutes = case when bonus_day = p_today then bonus_minutes + p_minutes else p_minutes end, bonus_day = p_today
   where id = r.profile_id and family_id = p_family;
  update time_requests set status = 'approved', granted_minutes = p_minutes, resolved_at = now() where id = r.id;
  return 'done';
end $$;

revoke all on function approve_bedtime_request(uuid, uuid, int, timestamptz, text, date) from public, anon, authenticated;
revoke all on function grant_bedtime_extension(uuid, uuid, date, text, int, timestamptz, uuid) from public, anon, authenticated;
revoke all on function approve_minutes_request(uuid, uuid, int, date) from public, anon, authenticated;
grant execute on function approve_bedtime_request(uuid, uuid, int, timestamptz, text, date) to service_role;
grant execute on function grant_bedtime_extension(uuid, uuid, date, text, int, timestamptz, uuid) to service_role;
grant execute on function approve_minutes_request(uuid, uuid, int, date) to service_role;

-- Daily minutes, granted directly by a parent: add them for today and answer today's pending ask with them.
create or replace function grant_minutes(p_family uuid, p_profile uuid, p_minutes int, p_today date)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from time_requests where profile_id = p_profile and family_id = p_family and kind = 'limit' and day = p_today and status = 'pending' for update;
  update profiles set bonus_minutes = case when bonus_day = p_today then bonus_minutes + p_minutes else p_minutes end, bonus_day = p_today
   where id = p_profile and family_id = p_family;
  if not found then raise exception 'not a child of this family'; end if;
  update time_requests set status = 'approved', granted_minutes = p_minutes, resolved_at = now()
   where profile_id = p_profile and family_id = p_family and kind = 'limit' and day = p_today and status = 'pending';
end $$;
revoke all on function grant_minutes(uuid, uuid, int, date) from public, anon, authenticated;
grant execute on function grant_minutes(uuid, uuid, int, date) to service_role;
