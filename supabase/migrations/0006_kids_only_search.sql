-- Optional: restrict kid search to videos YouTube flags "made for kids". Off by default:
-- that flag is a COPPA declaration, not a content judgment, and the AI card is the real gate.
alter table families add column kids_only_search boolean not null default false;
