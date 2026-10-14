-- 0021: requests are per child.
--
-- Before: one PENDING request per video per FAMILY (0004). If Maya had asked for a video, Leo asking for
-- the same video was silently dropped as a duplicate, and approving Maya's request never answered Leo.
-- Now: one pending request per video per CHILD. A child's repeat ask is still refused (no duplicate
-- notifications). Older requests that never recorded a child stay one-per-video between themselves.
--
-- Additive in effect (it only allows more rows). Not applied anywhere yet.
-- Rollback: supabase/rollbacks/0021_child_requests.down.sql

drop index if exists watch_requests_pending_idx;
create unique index if not exists watch_requests_pending_child_idx
  on watch_requests (family_id, video_id, profile_id) nulls not distinct
  where status = 'pending';
