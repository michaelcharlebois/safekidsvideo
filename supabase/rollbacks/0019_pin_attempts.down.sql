-- Undo 0019 (run BEFORE rolling back 0018). The app on feature/brightframe needs these functions:
-- after this rollback, shared screens refuse every PIN ("Couldn't check the PIN") until 0019 is re-applied.
drop function if exists public.pin_attempt_succeeded(uuid);
drop function if exists public.claim_pin_attempt(uuid, int, interval);
