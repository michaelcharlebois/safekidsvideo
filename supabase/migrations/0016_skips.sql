-- Skip budget (Pandora-style), per kid; and richer watch outcomes for stats.
alter table profiles add column if not exists skip_limit int;              -- null = off
alter table profiles add column if not exists skip_regen int not null default 1;
alter table profiles add column if not exists skip_cooldown_sec int not null default 120;
alter table profiles add column if not exists free_peek_sec int not null default 30;

alter table watch_events add column if not exists outcome text check (outcome in ('skipped','finished','left'));
alter table watch_events add column if not exists ended_at_sec int;
