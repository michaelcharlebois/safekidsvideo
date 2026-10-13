-- Version-1 AI reviews (made before the reviewer stopped filling in un-assessed concern categories).
-- Read-only. Run against production (or a copy) to size the re-review job.

-- 1. How many, in total and by whether some family could be shown the video.
--    "In a library" = its channel or the video itself is a family-wide content source somewhere. Those are
--    the cards that can make a video playable today, so re-review them first.
with v1 as (
  select c.video_id, v.channel_id, c.confidence
    from content_cards c join videos v on v.id = c.video_id
   where c.reviewer_version = '1' and c.reviewer_model <> 'sample'
),
sourced as (
  select distinct v1.video_id
    from v1 join whitelist w
      on w.profile_id is null and ((w.kind = 'channel' and w.target_id = v1.channel_id) or (w.kind = 'video' and w.target_id = v1.video_id))
)
select 'version-1 cards' as what, count(*)::text as n from v1
union all select 'in some family''s library (re-review first)', count(*)::text from sourced
union all select 'explicitly allowed for a child (plays regardless of review)', count(distinct w.target_id)::text
  from whitelist w join v1 on v1.video_id = w.target_id where w.kind = 'override'
union all select 'estimated cost at ~$0.01 per short video (USD)', round(count(*) * 0.01, 2)::text from v1;

-- 2. Library videos first: export these URLs, then re-review them in batches with
--      npm run review -- --force --file v1-library.txt
--    (--force bypasses the budget for this one-off job; use --upgrade-v1 --max N instead to stay
--    within DAILY_REVIEW_BUDGET_USD, oldest first). A failed re-review keeps the version-1 card.
select distinct 'https://www.youtube.com/watch?v=' || c.video_id as url
  from content_cards c join videos v on v.id = c.video_id
  join whitelist w on w.profile_id is null and ((w.kind = 'channel' and w.target_id = v.channel_id) or (w.kind = 'video' and w.target_id = c.video_id))
 where c.reviewer_version = '1' and c.reviewer_model <> 'sample';
