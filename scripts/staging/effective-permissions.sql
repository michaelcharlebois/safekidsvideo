-- The rollback invariant, checked on the STAGING database: after rolling back 0023 → 0018, no child may
-- watch anything they couldn't watch immediately before. Same evaluator as test/rollback-rehearsal.test.ts,
-- over every child × every video in the database, by the gate's permission order:
--   block → override → keep hidden → library video / channel / clearance.
-- Reviews and filters aren't touched by the rollback, so they're left out.
--
--   psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -v phase=before -f scripts/staging/effective-permissions.sql   (new schema, writes paused)
--   …run the rollbacks…
--   psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -v phase=after  -f scripts/staging/effective-permissions.sql   (old schema)
--
-- "after" prints the widened pairs (must be none) and fails if there are any. Works on either schema: a
-- row's child is read through to_jsonb, so the query runs whether or not whitelist.profile_id exists.
-- Staging only: it creates the table rehearsal_effective (drop it when the rehearsal is done).
\set ON_ERROR_STOP on
create table if not exists rehearsal_effective (phase text not null, family_id uuid not null, profile_id uuid not null, video_id text not null, at timestamptz not null default now());
delete from rehearsal_effective where phase = :'phase';

with wl as (
  select w.family_id, w.kind, w.target_id, (to_jsonb(w) ->> 'profile_id')::uuid as child from whitelist w
),
pairs as (
  select p.family_id, p.id as profile_id, v.id as video_id, v.channel_id from profiles p cross join videos v
),
mine as (
  -- On the old schema every row is family-wide (child is null), so it applies to every child.
  select x.family_id, x.profile_id, x.video_id, x.channel_id, w.kind, w.target_id
    from pairs x join wl w on w.family_id = x.family_id and (w.child is null or w.child = x.profile_id)
                          and (w.target_id = x.video_id or (w.kind = 'channel' and w.target_id = x.channel_id))
)
insert into rehearsal_effective (phase, family_id, profile_id, video_id)
select :'phase', family_id, profile_id, video_id from mine
 group by family_id, profile_id, video_id
having not bool_or(kind = 'block' and target_id = video_id)
   and (bool_or(kind = 'override' and target_id = video_id)
        or (not bool_or(kind = 'dismissed' and target_id = video_id)
            and bool_or((kind in ('video', 'auto') and target_id = video_id) or kind = 'channel')));

select phase, count(*) as child_video_pairs_allowed from rehearsal_effective group by phase order by phase;

select :'phase' = 'after' as is_after \gset
\if :is_after
  \echo '▶ Widened (allowed after the rollback, not before) — must be empty:'
  select a.family_id, a.profile_id, a.video_id from rehearsal_effective a
   where a.phase = 'after'
     and not exists (select 1 from rehearsal_effective b where b.phase = 'before' and b.family_id = a.family_id and b.profile_id = a.profile_id and b.video_id = a.video_id);
  \echo '▶ Narrowed (dropped; a parent restores these by hand from rollback_0018_report):'
  select b.family_id, b.profile_id, b.video_id from rehearsal_effective b
   where b.phase = 'before'
     and not exists (select 1 from rehearsal_effective a where a.phase = 'after' and a.family_id = b.family_id and a.profile_id = b.profile_id and a.video_id = b.video_id);
  do $$ begin
    if exists (select 1 from rehearsal_effective a where a.phase = 'after'
                 and not exists (select 1 from rehearsal_effective b where b.phase = 'before' and b.family_id = a.family_id and b.profile_id = a.profile_id and b.video_id = a.video_id)) then
      raise exception 'ROLLBACK WIDENED ACCESS: see the rows above';
    end if;
  end $$;
  \echo '✓ no child gained access'
\endif
