-- Video format axis + per-family blocked formats
alter table content_cards add column format text not null default 'other';
alter table families add column blocked_formats text[] not null default '{gameplay_commentary}';
