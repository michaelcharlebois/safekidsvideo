-- Richer parent feedback + a versioned set of reviewer calibration notes the AI learns from.

alter table confirmations drop constraint if exists confirmations_verdict_check;
alter table confirmations add constraint confirmations_verdict_check
  check (verdict in ('agree','flag','too_strict','too_lenient'));
alter table confirmations add column if not exists tag_votes jsonb not null default '{}'::jsonb; -- {tag: 'agree'|'overcall'|'missed'}
alter table confirmations add column if not exists age_vote text check (age_vote in ('younger','right','older'));

-- Card revisions after feedback.
alter table content_cards add column if not exists revisions int not null default 0;
alter table content_cards add column if not exists notes_version int;

create table if not exists reviewer_notes (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  notes text not null,            -- the calibration guidelines appended to the reviewer prompt
  stats jsonb,                    -- agreement stats that produced them
  source text not null default 'learn', -- 'learn' (AI distilled) | 'manual' (a parent edited)
  created_at timestamptz not null default now()
);
alter table reviewer_notes enable row level security;
create policy "public read reviewer_notes" on reviewer_notes for select using (true);
