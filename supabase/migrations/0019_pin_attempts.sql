-- 0019: atomic shared-screen PIN lockout.
--
-- Before: the app read pin_failures, decided, and wrote it back in separate calls, so parallel guesses
-- could each see "4 failures" and all get through. Now each attempt is claimed in ONE statement that
-- takes the device row lock: a locked device is refused; otherwise the attempt is counted up front
-- (as if it will fail) and the 5th claim sets the lock. A correct PIN then clears the count.
-- At most PIN_MAX_FAILURES guesses per lock window, however many arrive at once.
--
-- Apply together with 0018 (it uses 0018's devices.pin_failures / pin_locked_until).
-- Rollback: supabase/rollbacks/0019_pin_attempts.down.sql

create or replace function public.claim_pin_attempt(
  p_device uuid,
  p_max int default 5,
  p_lock interval default interval '5 minutes'
) returns table (allowed boolean, seconds_left int)
language plpgsql
volatile
set search_path = public
as $$
declare
  d record;
begin
  -- Row lock: concurrent claims on the same device run one after another.
  select pin_failures, pin_locked_until into d
    from devices
   where id = p_device and revoked_at is null
   for update;
  if not found then
    return query select false, 0;               -- unknown / revoked device: refuse
    return;
  end if;
  if d.pin_locked_until is not null and d.pin_locked_until > now() then
    return query select false, greatest(1, ceil(extract(epoch from d.pin_locked_until - now()))::int);
    return;
  end if;
  if coalesce(d.pin_failures, 0) + 1 >= p_max then
    update devices set pin_failures = 0, pin_locked_until = now() + p_lock where id = p_device;
  else
    update devices set pin_failures = coalesce(d.pin_failures, 0) + 1, pin_locked_until = null where id = p_device;
  end if;
  return query select true, 0;
end;
$$;

-- A correct PIN: forget the counted attempts (and any lock this very attempt triggered).
create or replace function public.pin_attempt_succeeded(p_device uuid) returns void
language sql
volatile
set search_path = public
as $$
  update devices set pin_failures = 0, pin_locked_until = null where id = p_device and revoked_at is null;
$$;

-- Server-only: browsers (anon / signed-in users) must not be able to reset a device's counter.
revoke all on function public.claim_pin_attempt(uuid, int, interval) from public;
revoke all on function public.pin_attempt_succeeded(uuid) from public;
do $$ begin
  revoke all on function public.claim_pin_attempt(uuid, int, interval) from anon, authenticated;
  revoke all on function public.pin_attempt_succeeded(uuid) from anon, authenticated;
exception when undefined_object then null; end $$;
do $$ begin
  grant execute on function public.claim_pin_attempt(uuid, int, interval) to service_role;
  grant execute on function public.pin_attempt_succeeded(uuid) to service_role;
exception when undefined_object then null; end $$;
