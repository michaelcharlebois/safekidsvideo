-- Per-kid home-screen arrangement: channel order, and boosts that shape the "For <kid>" row.
alter table profiles add column if not exists channel_order text[] not null default '{}';
alter table profiles add column if not exists boosts jsonb not null default '{}'::jsonb;  -- { formats: {song: 1,...}, pace: -2..2, learning: -2..2 }
