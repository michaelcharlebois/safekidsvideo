-- Rollback for 0022. Roll the app back first: the build that stores more-time requests needs this table.
-- Drops the stored requests (they're short-lived: one day).
drop table if exists time_requests;
