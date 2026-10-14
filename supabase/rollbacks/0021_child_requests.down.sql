-- Rollback for 0021 (one pending request per child → per family again). Where two children have pending
-- requests for the same video, the earliest is kept (the previous build shows requests family-wide, so one
-- answers both) and the others are listed in rollback_0021_report and removed, so the old index can be built.
create table if not exists rollback_0021_report (id uuid, family_id uuid, video_id text, profile_id uuid, created_at timestamptz, reported_at timestamptz default now());
with ranked as (
  select id, row_number() over (partition by family_id, video_id order by created_at, id) as n
    from watch_requests where status = 'pending'
)
insert into rollback_0021_report (id, family_id, video_id, profile_id, created_at)
select r.id, r.family_id, r.video_id, r.profile_id, r.created_at from watch_requests r join ranked k on k.id = r.id where k.n > 1;
delete from watch_requests where id in (select id from rollback_0021_report);
drop index if exists watch_requests_pending_child_idx;
create unique index if not exists watch_requests_pending_idx on watch_requests (family_id, video_id) where status = 'pending';
