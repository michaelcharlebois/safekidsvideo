-- Read-only checks to run against a COPY of production (or production itself — it changes nothing)
-- BEFORE applying 0018. Every "must be 0" row must be 0, or 0018 will fail partway (it runs in a
-- transaction, so a failure leaves the database unchanged — but fix the data first).

select 'Postgres version (needs 15+)' as check, current_setting('server_version') as value
union all
select 'already migrated? (whitelist.profile_id exists)', exists (
  select 1 from information_schema.columns where table_name = 'whitelist' and column_name = 'profile_id')::text
union all
select 'must be 0: watch_events with a child from another family', count(*)::text
  from watch_events e join profiles p on p.id = e.profile_id where p.family_id <> e.family_id
union all
select 'must be 0: kid_checks with a child from another family', count(*)::text
  from kid_checks e join profiles p on p.id = e.profile_id where p.family_id <> e.family_id
union all
select 'must be 0: watch_requests with a child from another family', count(*)::text
  from watch_requests e join profiles p on p.id = e.profile_id where p.family_id <> e.family_id
union all
select 'must be 0: kid_days with a child from another family', count(*)::text
  from kid_days e join profiles p on p.id = e.profile_id where p.family_id <> e.family_id
union all
select 'families', count(*)::text from families
union all
select 'families with 2+ kids', count(*)::text from (select family_id from profiles group by family_id having count(*) > 1) x
union all
select 'kids with no age (0018 fills from the family)', count(*)::text from profiles where age is null
union all
select 'whitelist ' || kind, count(*)::text from whitelist group by kind;
