-- Read-only audit of historical watch_events before/after 0020. Safe on production or a copy.
-- The app already folds these rows correctly (src/lib/sessions.ts); this only sizes what was affected.

-- 1. Rows by shape.
select
  count(*) filter (where session_id is null and outcome is null and not completed) as legacy_starts,
  count(*) filter (where session_id is null and outcome is null and completed)     as legacy_completion_rows,  -- the old double count
  count(*) filter (where session_id is null and outcome is not null)               as legacy_end_rows,
  count(*) filter (where session_id is not null)                                   as session_rows,
  count(*) filter (where profile_id is null)                                       as no_child_rows
from watch_events;

-- 2. Old completion rows that duplicated a start of the same video/child within the video's length + 15 min
--    (each one was counted as an extra play before this fix).
select count(*) as duplicated_plays
from watch_events c
join videos v on v.id = c.video_id
where c.session_id is null and c.outcome is null and c.completed
  and exists (
    select 1 from watch_events s
    where s.session_id is null and s.outcome is null and not s.completed
      and s.family_id = c.family_id and s.video_id = c.video_id and s.profile_id is not distinct from c.profile_id
      and s.started_at <= c.started_at
      and c.started_at - s.started_at <= make_interval(secs => coalesce(v.duration_seconds, 300) + 900)
  );

-- 3. Unattributed rows in families with more than one child (now shown separately, counted for no child).
select w.family_id, count(*) as no_child_rows
from watch_events w
where w.profile_id is null
  and (select count(*) from profiles p where p.family_id = w.family_id) > 1
group by w.family_id
order by no_child_rows desc
limit 50;
