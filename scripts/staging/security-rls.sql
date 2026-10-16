-- Security integration smoke test for staging only.
-- Writes two synthetic confirmation rows inside a transaction, tests RLS as each
-- parent and as anon, then ROLLBACK restores all original values.
-- On any error, ON_ERROR_STOP terminates the session, also rolling back.
\set ON_ERROR_STOP on
\set family_one '5a000000-0000-4000-8000-000000000001'
\set family_two '5a000000-0000-4000-8000-000000000002'

BEGIN;
SET LOCAL statement_timeout = '15s';

-- The three test families were seeded in the isolated staging project.
SELECT owner_user_id::text AS owner_one FROM public.families WHERE id = :'family_one'::uuid \gset
SELECT owner_user_id::text AS owner_two FROM public.families WHERE id = :'family_two'::uuid \gset
SELECT id AS probe_video FROM public.videos ORDER BY id LIMIT 1 \gset
SELECT 'bf-rls-probe-' || txid_current()::text AS probe_note \gset

-- Never permanently alter a confirmation: even ON CONFLICT changes roll back.
INSERT INTO public.confirmations (video_id, family_id, verdict, note)
VALUES
  (:'probe_video', :'family_one'::uuid, 'agree', :'probe_note'),
  (:'probe_video', :'family_two'::uuid, 'agree', :'probe_note')
ON CONFLICT (video_id, family_id) DO UPDATE
  SET verdict = EXCLUDED.verdict, note = EXCLUDED.note;

-- Parent one must see one private feedback record and only own child profiles.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'owner_one', true) AS _sub \gset
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner_one', 'role', 'authenticated')::text, true) AS _claims \gset
SELECT (
  auth.uid() = :'owner_one'::uuid
  AND (SELECT count(*) FROM public.confirmations WHERE note = :'probe_note') = 1
  AND (SELECT count(*) FROM public.confirmations WHERE note = :'probe_note' AND family_id = :'family_two'::uuid) = 0
  AND EXISTS (SELECT 1 FROM public.profiles WHERE family_id = :'family_one'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE family_id = :'family_two'::uuid)
) AS parent_one_ok \gset
\if :parent_one_ok
\echo PASS: parent one sees own feedback and children only
\else
\echo FAIL: parent one family-isolation test
SELECT 1 / 0;
\endif

-- Parent two must get the inverse result.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'owner_two', true) AS _sub \gset
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner_two', 'role', 'authenticated')::text, true) AS _claims \gset
SELECT (
  auth.uid() = :'owner_two'::uuid
  AND (SELECT count(*) FROM public.confirmations WHERE note = :'probe_note') = 1
  AND (SELECT count(*) FROM public.confirmations WHERE note = :'probe_note' AND family_id = :'family_one'::uuid) = 0
  AND EXISTS (SELECT 1 FROM public.profiles WHERE family_id = :'family_two'::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE family_id = :'family_one'::uuid)
) AS parent_two_ok \gset
\if :parent_two_ok
\echo PASS: parent two sees own feedback and children only
\else
\echo FAIL: parent two family-isolation test
SELECT 1 / 0;
\endif

-- Anonymous clients must see neither family's comments nor child profiles.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true) AS _sub \gset
SELECT set_config('request.jwt.claims', '{}', true) AS _claims \gset
SELECT (
  auth.uid() IS NULL
  AND (SELECT count(*) FROM public.confirmations WHERE note = :'probe_note') = 0
  AND (SELECT count(*) FROM public.profiles WHERE family_id IN (:'family_one'::uuid, :'family_two'::uuid)) = 0
) AS anon_ok \gset
\if :anon_ok
\echo PASS: anonymous client sees no private feedback or children
\else
\echo FAIL: anonymous family-isolation test
SELECT 1 / 0;
\endif

RESET ROLE;
ROLLBACK;
\echo PASS: temporary synthetic test records rolled back
