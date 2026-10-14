-- Rollback for 0021. Fails if two children have pending requests for the same video (resolve one first).
drop index if exists watch_requests_pending_child_idx;
create unique index if not exists watch_requests_pending_idx on watch_requests (family_id, video_id) where status = 'pending';
