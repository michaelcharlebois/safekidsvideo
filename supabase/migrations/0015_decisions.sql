-- Parent decisions on individual videos: 'block' = never show this one; 'dismissed' = reviewed, leave hidden, stop asking me.
alter table whitelist drop constraint if exists whitelist_kind_check;
alter table whitelist add constraint whitelist_kind_check check (kind in ('channel','video','override','auto','block','dismissed'));
