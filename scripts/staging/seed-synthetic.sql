-- Synthetic data for the Brightframe STAGING project. No production data.
-- Run AFTER migrations 0001 → 0017 and BEFORE 0018, so 0018's attribution runs on pre-release-shaped data:
--
--   psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 \
--     -v owner_two=<auth user id> -v owner_one=<auth user id> -v owner_three=<auth user id> \
--     -f scripts/staging/seed-synthetic.sql
--
-- The three owners are test sign-ins created in the staging project's Authentication page (see
-- docs/brightframe/18-staging-runbook.md). It refuses to run on a database that already has families, or
-- that is already past 0018 — so it can't be run against production or a copy of it by mistake.
--
-- Families:
--   "Two kids"   (owner_two)   Maya 6, Leo 4    — every rollback scenario from test/rollback-rehearsal.test.ts
--   "One kid"    (owner_one)   Solo 6           — one-child family: everything must carry back exactly
--   "Three kids" (owner_three) Ava 8, Ben 6, Cy 3 — an approval two of three children have
-- Every family's kid-screen PIN is 2580 (synthetic; stored the way a new family's default is, and hashed
-- once a parent changes it). Videos are synthetic ids (stg + 8 chars): they exercise authorization, not YouTube. Real YouTube is
-- tested by adding real channels through the app (checklist §4).
\set ON_ERROR_STOP on
begin;

do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'whitelist' and column_name = 'profile_id') then
    raise exception 'seed-synthetic: this database is already past 0018. Seed a fresh staging project at 0017.';
  end if;
  if exists (select 1 from families) then
    raise exception 'seed-synthetic: families already exist. This seed only runs on an empty staging project.';
  end if;
end $$;

-- psql variables → a temp table, so the PL/pgSQL above and the inserts below can use them.
create temp table _o on commit drop as select :'owner_two'::uuid as two, :'owner_one'::uuid as one, :'owner_three'::uuid as three;

insert into families (id, owner_user_id, pin_hash, plan, trial_ends_at, onboarded_at, timezone)
select '5a000000-0000-4000-8000-000000000002'::uuid, two, '2580', 'free', null::timestamptz, now(), 'America/Los_Angeles' from _o union all
select '5a000000-0000-4000-8000-000000000001', one, '2580', 'free', null, now(), 'America/Los_Angeles' from _o union all
select '5a000000-0000-4000-8000-000000000003', three, '2580', 'free', null, now(), 'America/New_York' from _o;

insert into profiles (id, family_id, name, age, sort, mode) values
  ('5b000000-0000-4000-8000-0000000000a1', '5a000000-0000-4000-8000-000000000002', 'Maya', 6, 0, 'open'),
  ('5b000000-0000-4000-8000-0000000000a2', '5a000000-0000-4000-8000-000000000002', 'Leo', 4, 1, 'locked'),
  ('5b000000-0000-4000-8000-0000000000a3', '5a000000-0000-4000-8000-000000000001', 'Solo', 6, 0, 'open'),
  ('5b000000-0000-4000-8000-0000000000b1', '5a000000-0000-4000-8000-000000000003', 'Ava', 8, 0, 'open'),
  ('5b000000-0000-4000-8000-0000000000b2', '5a000000-0000-4000-8000-000000000003', 'Ben', 6, 1, 'open'),
  ('5b000000-0000-4000-8000-0000000000b3', '5a000000-0000-4000-8000-000000000003', 'Cy', 3, 2, 'locked');

insert into channels (id, title) values ('UCstgKeep000000000000000', 'Staging: kept channel'), ('UCstgGone000000000000000', 'Staging: channel removed after release');
insert into videos (id, channel_id, title, duration_seconds)
select 'stg' || lpad(g::text, 8, '0'),
       case when g in (6, 9) then 'UCstgKeep000000000000000' when g in (13, 14) then 'UCstgGone000000000000000' end,
       'Staging video ' || g, 180
  from generate_series(1, 20) g;

-- Pre-release permissions: family-wide only (the shape the current production build writes).
insert into whitelist (family_id, kind, target_id) values
  ('5a000000-0000-4000-8000-000000000002', 'channel',   'UCstgKeep000000000000000'),
  ('5a000000-0000-4000-8000-000000000002', 'channel',   'UCstgGone000000000000000'),
  ('5a000000-0000-4000-8000-000000000002', 'override',  'stg00000001'), -- Maya asked (request below): 0018 attributes it to Maya
  ('5a000000-0000-4000-8000-000000000002', 'override',  'stg00000002'), -- no child recorded: held, grants nobody
  ('5a000000-0000-4000-8000-000000000002', 'override',  'stg00000003'), -- held; dismiss it after release (runbook §5)
  ('5a000000-0000-4000-8000-000000000002', 'block',     'stg00000004'), -- family-wide restriction
  ('5a000000-0000-4000-8000-000000000002', 'dismissed', 'stg00000009'), -- family-wide Keep hidden, inside the kept channel
  ('5a000000-0000-4000-8000-000000000001', 'override',  'stg00000005'), -- one-child family: attributed to Solo
  ('5a000000-0000-4000-8000-000000000003', 'override',  'stg00000015'), -- Ava asked: attributed to Ava
  ('5a000000-0000-4000-8000-000000000003', 'video',     'stg00000016'); -- family-wide library video
insert into watch_requests (family_id, video_id, status, profile_id, resolved_at) values
  ('5a000000-0000-4000-8000-000000000002', 'stg00000001', 'approved', '5b000000-0000-4000-8000-0000000000a1', now()),
  ('5a000000-0000-4000-8000-000000000002', 'stg00000002', 'approved', null, now()),
  ('5a000000-0000-4000-8000-000000000002', 'stg00000003', 'approved', null, now()),
  ('5a000000-0000-4000-8000-000000000003', 'stg00000015', 'approved', '5b000000-0000-4000-8000-0000000000b1', now());
insert into kid_checks (family_id, video_id, outcome, profile_id) values
  ('5a000000-0000-4000-8000-000000000003', 'stg00000017', 'passed', '5b000000-0000-4000-8000-0000000000b2');

-- Some viewing, so watch-session accounting (0020) and Activity have rows to show.
insert into watch_events (family_id, video_id, profile_id, started_at, completed)
select f, 'stg' || lpad((1 + (g % 6))::text, 8, '0'), p, now() - (g || ' hours')::interval, g % 3 = 0
  from (values ('5a000000-0000-4000-8000-000000000002'::uuid, '5b000000-0000-4000-8000-0000000000a1'::uuid),
               ('5a000000-0000-4000-8000-000000000002', '5b000000-0000-4000-8000-0000000000a2'),
               ('5a000000-0000-4000-8000-000000000001', '5b000000-0000-4000-8000-0000000000a3')) x(f, p),
       generate_series(1, 12) g;

commit;

select 'seeded families' as what, count(*)::text as n from families
union all select 'children', count(*)::text from profiles
union all select 'permission rows', count(*)::text from whitelist
union all select 'push subscriptions (must be 0)', count(*)::text from push_subscriptions
union all select 'billing customers (must be 0)', count(*)::text from families where stripe_customer_id is not null;
