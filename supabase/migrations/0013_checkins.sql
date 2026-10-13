-- "How was he today?" — one row per kid per day, correlated later with what they watched.
create table if not exists kid_days (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  day date not null,
  mood int not null check (mood between 1 and 4),   -- 1 rough · 2 meh · 3 good · 4 great
  note text,
  created_at timestamptz not null default now(),
  unique (profile_id, day)
);
create index if not exists kid_days_family_idx on kid_days(family_id, day desc);
alter table kid_days enable row level security;
create policy "own kid days" on kid_days for all
  using (family_id in (select id from families where owner_user_id = auth.uid()))
  with check (family_id in (select id from families where owner_user_id = auth.uid()));

alter table families add column if not exists timezone text; -- IANA, learned from the parent's browser
