-- ============================================================ REWARDS: TIER-BASED COST (PATCH) 2026-07-10
-- Follow-up to 2026-07-10_rewards.sql for databases that already ran its FIRST version, where the
-- cost lived per reward (rewards.cost_stars). The model changed: the cost now lives on the TIER.
-- reward_tiers.stars is both the tier's unlock threshold AND the price to redeem any reward in it —
-- reaching the threshold unlocks the whole tier, and redeeming spends that many stars (1 star = 10
-- streck). Run this ONCE on an already-deployed database (do NOT re-run the base migration). It is
-- idempotent, and a harmless no-op on a fresh database that already built the final schema.

-- 1) the cost / unlock threshold now lives on the tier (existing tiers default to 1 ⭐; retune in the app)
alter table public.reward_tiers add column if not exists stars integer not null default 1;

-- 2) rewards no longer carry an individual price — they inherit the tier's
alter table public.rewards drop column if exists cost_stars;

-- 3) redemptions price off the reward's tier instead of the reward
create or replace function public.request_redemption(p_reward uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rewards; tier_stars int; cost int; bal int;
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  select * into r from public.rewards where id = p_reward and active;
  if not found then raise exception 'Belöningen finns inte'; end if;
  select stars into tier_stars from public.reward_tiers where id = r.tier_id;   -- cost lives on the tier
  if tier_stars is null then raise exception 'Belöningen saknar nivå'; end if;
  cost := tier_stars * 10;   -- 1 star = 10 streck
  select coalesce(sum(amount), 0) into bal from public.mark_ledger where profile_id = auth.uid();
  if bal < cost then raise exception 'Du har inte tillräckligt med streck'; end if;
  insert into public.reward_redemptions (profile_id, reward_id, cost_marks, status)
    values (auth.uid(), p_reward, cost, 'pending');
  insert into public.mark_ledger (profile_id, amount, reason, created_by)
    values (auth.uid(), -cost, 'Inlöst: ' || r.title, auth.uid());
end; $$;
