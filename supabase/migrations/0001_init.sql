-- SafeKidsVideo initial schema
-- Run in the Supabase SQL editor or via `supabase db push`.

create extension if not exists "pgcrypto";

-- Families are the account unit. Parents only — no child accounts, no child data (COPPA).
create table families (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete cascade,
  name text,
  pin_hash text not null,
  kid_age int,
  blocked_tags text[] not null default '{}',
  flag_threshold int not null default 3,
  created_at timestamptz not null default now()
);

create table channels (
  id text primary key,                    -- YouTube channel id (UC...)
  title text not null,
  handle text,
  thumbnail_url text,
  description text,
  created_at timestamptz not null default now()
);

create table videos (
  id text primary key,                    -- YouTube video id
  channel_id text references channels(id) on delete set null,
  title text not null,
  thumbnail_url text,
  duration_seconds int,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index videos_channel_idx on videos(channel_id);

-- One AI review per video; re-running the reviewer upserts.
create table content_cards (
  video_id text primary key references videos(id) on delete cascade,
  synopsis text not null,
  age_min int not null,
  age_max int not null,
  concerns jsonb not null,                -- ConcernFinding[]
  pace text not null check (pace in ('calm','moderate','frenetic')),
  educational_value numeric(2,1) not null,
  rating numeric(2,1) not null,
  parent_recommendation text not null,
  confidence numeric(3,2) not null,
  reviewer_model text not null,
  reviewer_version text not null,
  reviewed_at timestamptz not null default now()
);

create table confirmations (
  id uuid primary key default gen_random_uuid(),
  video_id text not null references videos(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  verdict text not null check (verdict in ('agree','flag')),
  tags text[],
  note text,
  kid_age int,
  created_at timestamptz not null default now(),
  unique (video_id, family_id)
);
create index confirmations_video_idx on confirmations(video_id);

create table whitelist (
  family_id uuid not null references families(id) on delete cascade,
  kind text not null check (kind in ('channel','video')),
  target_id text not null,
  created_at timestamptz not null default now(),
  primary key (family_id, kind, target_id)
);

-- Row level security: review data is public-read, family data is private.
alter table families enable row level security;
alter table channels enable row level security;
alter table videos enable row level security;
alter table content_cards enable row level security;
alter table confirmations enable row level security;
alter table whitelist enable row level security;

create policy "public read channels" on channels for select using (true);
create policy "public read videos" on videos for select using (true);
create policy "public read cards" on content_cards for select using (true);
create policy "public read confirmations" on confirmations for select using (true);

create policy "own family" on families for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy "own whitelist" on whitelist for all
  using (family_id in (select id from families where owner_user_id = auth.uid()))
  with check (family_id in (select id from families where owner_user_id = auth.uid()));

create policy "own confirmations write" on confirmations for insert
  with check (family_id in (select id from families where owner_user_id = auth.uid()));
create policy "own confirmations update" on confirmations for update
  using (family_id in (select id from families where owner_user_id = auth.uid()));

-- Writes to channels/videos/content_cards come from the reviewer script using the service role key.
