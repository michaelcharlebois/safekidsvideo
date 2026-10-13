-- Screen-time: a parent can grant extra minutes for today.
alter table profiles add column if not exists bonus_minutes int not null default 0;
alter table profiles add column if not exists bonus_day date;
