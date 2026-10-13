-- Token usage + estimated cost per review, so we can meter the reviewer.
alter table content_cards add column if not exists input_tokens int;
alter table content_cards add column if not exists output_tokens int;
alter table content_cards add column if not exists cost_usd numeric(8,5);
