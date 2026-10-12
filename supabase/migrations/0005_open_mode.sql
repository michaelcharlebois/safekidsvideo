-- Open mode: kids can search beyond approved channels; the review layer + filters decide what plays.

alter table families add column mode text not null default 'locked'
  check (mode in ('locked','open','open_ask'));
alter table families add column daily_check_limit int not null default 20;

-- 'auto': added by a kid-triggered AI check that passed the family's filters.
alter table whitelist drop constraint if exists whitelist_kind_check;
alter table whitelist add constraint whitelist_kind_check check (kind in ('channel','video','override','auto'));

-- Kid-triggered checks, for the daily cap.
create table kid_checks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  video_id text not null,
  outcome text not null check (outcome in ('passed','blocked','needs_parent','failed')),
  created_at timestamptz not null default now()
);
create index kid_checks_family_time_idx on kid_checks(family_id, created_at desc);
alter table kid_checks enable row level security;
create policy "own kid checks" on kid_checks for select
  using (family_id in (select id from families where owner_user_id = auth.uid()));
