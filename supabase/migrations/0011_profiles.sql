-- Kid profiles: each kid gets their own viewing mode, filters and limits. Family keeps PIN + crowd threshold.

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  age int,
  avatar text not null default '🦊',          -- an emoji
  interests text[] not null default '{}',
  mode text not null default 'locked' check (mode in ('locked','open','open_ask')),
  blocked_tags text[] not null default '{violence,scary_imagery,monsters}',
  blocked_formats text[] not null default '{gameplay_commentary}',
  hide_unreviewed boolean not null default true,
  daily_check_limit int not null default 20,
  kids_only_search boolean not null default false,
  daily_minutes int,                           -- screen-time limit; null = none
  bedtime text,                                -- 'HH:MM' local; null = none
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists profiles_family_idx on profiles(family_id);
alter table profiles enable row level security;
create policy "own profiles" on profiles for all
  using (family_id in (select id from families where owner_user_id = auth.uid()));

-- One profile per existing family, carrying over its current settings.
insert into profiles (family_id, name, age, mode, blocked_tags, blocked_formats, hide_unreviewed, daily_check_limit, kids_only_search)
select f.id, 'My kid', f.kid_age, coalesce(f.mode, 'locked'), coalesce(f.blocked_tags, '{violence,scary_imagery,monsters}'),
       coalesce(f.blocked_formats, '{gameplay_commentary}'), coalesce(f.hide_unreviewed, true), coalesce(f.daily_check_limit, 20), coalesce(f.kids_only_search, false)
from families f
where not exists (select 1 from profiles p where p.family_id = f.id);

-- Activity carries the profile.
alter table watch_events add column if not exists profile_id uuid references profiles(id) on delete set null;
alter table kid_checks add column if not exists profile_id uuid references profiles(id) on delete set null;
alter table watch_requests add column if not exists profile_id uuid references profiles(id) on delete set null;

-- Pairing codes grow to 8 digits (the column is text; nothing to change) — noted for the record.
