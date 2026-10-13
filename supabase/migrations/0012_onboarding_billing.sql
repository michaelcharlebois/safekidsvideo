-- Onboarding + subscription state on the family.
alter table families add column if not exists onboarded_at timestamptz;
alter table families add column if not exists plan text not null default 'trial' check (plan in ('trial','active','past_due','canceled','free'));
alter table families add column if not exists trial_ends_at timestamptz;
alter table families add column if not exists stripe_customer_id text unique;
alter table families add column if not exists stripe_subscription_id text;
-- Existing families: start their 30-day trial now.
update families set trial_ends_at = now() + interval '30 days' where trial_ends_at is null;
