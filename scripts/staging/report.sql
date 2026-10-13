-- After applying 0018 + 0019 to a staging copy: what happened to the old approvals.
select 'override/auto attributed to one child' as what, count(*)::text as n
  from whitelist where kind in ('override','auto')
union all
select 'held for parent review (legacy_grants)', count(*)::text from legacy_grants
union all
select 'held: old parent approvals', count(*)::text from legacy_grants where kind = 'override'
union all
select 'held: old open-mode clearances', count(*)::text from legacy_grants where kind = 'auto'
union all
select 'families with something held', count(distinct family_id)::text from legacy_grants
union all
select 'must be 0: override/auto with no child', count(*)::text from whitelist where kind in ('override','auto') and profile_id is null
union all
select 'must be 0: kids with no age', count(*)::text from profiles where age is null
union all
select 'snapshot rows (whitelist_pre_0018)', count(*)::text from whitelist_pre_0018
union all
select 'PIN functions installed', count(*)::text from pg_proc where proname in ('claim_pin_attempt','pin_attempt_succeeded');
