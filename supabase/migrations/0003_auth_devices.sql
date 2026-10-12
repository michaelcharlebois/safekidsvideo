-- Parent sign-in + kid-device pairing.
--
-- Model: a parent signs in (Supabase Auth, magic link). Their account owns one family.
-- Kid devices never sign in: a parent generates a 6-digit code, the tablet enters it,
-- and the tablet gets a long-lived device token (stored in an httpOnly cookie) that
-- maps to the family. All data access goes through the Next.js server with the secret
-- key; RLS below is defense-in-depth for any direct client access.

-- One family per owner (for now).
create unique index if not exists families_owner_idx on families(owner_user_id);

-- Short-lived pairing codes a parent generates.
create table pairing_codes (
  code text primary key,                       -- 6 digits
  family_id uuid not null references families(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index pairing_codes_family_idx on pairing_codes(family_id);

-- Paired kid devices.
create table devices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  token_hash text not null unique,              -- sha256 of the cookie token
  name text not null default 'Tablet',
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create index devices_family_idx on devices(family_id);

-- Kid watch history, per device. Only video ids + timestamps; no child identity.
create table watch_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  video_id text not null references videos(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed boolean not null default false
);
create index watch_events_family_time_idx on watch_events(family_id, started_at desc);

-- "Ask a grown-up" requests from a kid device.
create table watch_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  video_id text not null references videos(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (family_id, video_id, status) deferrable initially deferred
);

alter table pairing_codes enable row level security;
alter table devices enable row level security;
alter table watch_events enable row level security;
alter table watch_requests enable row level security;

create policy "own pairing codes" on pairing_codes for all
  using (family_id in (select id from families where owner_user_id = auth.uid()))
  with check (family_id in (select id from families where owner_user_id = auth.uid()));
create policy "own devices" on devices for all
  using (family_id in (select id from families where owner_user_id = auth.uid()))
  with check (family_id in (select id from families where owner_user_id = auth.uid()));
create policy "own watch events" on watch_events for select
  using (family_id in (select id from families where owner_user_id = auth.uid()));
create policy "own watch requests" on watch_requests for all
  using (family_id in (select id from families where owner_user_id = auth.uid()))
  with check (family_id in (select id from families where owner_user_id = auth.uid()));

-- Clean up stale codes occasionally (safe to run any time).
create or replace function purge_pairing_codes() returns void language sql as $$
  delete from pairing_codes where expires_at < now() - interval '1 day';
$$;
