-- 0024 — Parent feedback must not be readable through the public Supabase API.
--
-- Each family can read its own raw feedback. The server-side review service uses
-- a service role to compute aggregate peer results without exposing raw rows.
-- Do not restore the old public read policy during a release rollback.
begin;

drop policy if exists "public read confirmations" on public.confirmations;
drop policy if exists "own confirmations read" on public.confirmations;

create policy "own confirmations read" on public.confirmations for select
  using (family_id in (select id from public.families where owner_user_id = auth.uid()));

commit;
