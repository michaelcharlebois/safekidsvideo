-- "Ask a grown-up" + per-video filter overrides + hide-unreviewed setting.

-- A parent can approve a specific video *despite* their filters (e.g. after a kid request).
alter table whitelist drop constraint if exists whitelist_kind_check;
alter table whitelist add constraint whitelist_kind_check check (kind in ('channel','video','override'));

-- Hide videos from approved channels until they have a content card.
alter table families add column hide_unreviewed boolean not null default true;

-- Replace the awkward deferred unique with a partial unique: one *pending* request per video per family.
alter table watch_requests drop constraint if exists watch_requests_family_id_video_id_status_key;
create unique index if not exists watch_requests_pending_idx
  on watch_requests(family_id, video_id) where status = 'pending';
