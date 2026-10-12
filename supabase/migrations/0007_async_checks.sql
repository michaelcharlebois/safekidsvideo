-- Kid checks run in the background now; track pending ones.
alter table kid_checks drop constraint if exists kid_checks_outcome_check;
alter table kid_checks add constraint kid_checks_outcome_check
  check (outcome in ('pending','passed','blocked','needs_parent','failed'));
alter table kid_checks add column resolved_at timestamptz;
