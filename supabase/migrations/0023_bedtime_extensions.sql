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
