-- ============================================================ BELÖNINGAR (REWARD SHOP) 2026-07-10
-- Phase 2 of the streck system: a shop where kids spend the streck ("marks") they earn in Rutiner.
-- Rewards are grouped into parent-made tiers and priced in stars (1 star = 10 streck). Redeeming
-- RESERVES the streck immediately (a negative mark_ledger row) and creates a pending redemption a
-- parent then fulfils (hands the reward over) or cancels (which refunds the streck). A per-reward
-- `poolable` flag is set here but only used by the later Familjemål (pooling) phase.
--
--   reward_tiers        parent-made groupings (e.g. "Små belöningar"). Parents manage; family reads.
--   rewards             the shop items: a title, an emoji, a cost in stars, a tier, a poolable flag.
--   reward_redemptions  a kid's "I want this" — pending until a parent fulfils or cancels it.
-- Run AFTER 2026-07-10_marks.sql (redemptions deduct from mark_ledger). Idempotent.

-- ---- tiers ----
create table if not exists public.reward_tiers (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(btrim(title)) > 0),
  emoji      text,
  sort       integer not null default 0,
  active     boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.reward_tiers enable row level security;
drop policy if exists "family reads reward tiers" on public.reward_tiers;
create policy "family reads reward tiers" on public.reward_tiers
  for select using (auth.uid() is not null);
drop policy if exists "parents manage reward tiers" on public.reward_tiers;
create policy "parents manage reward tiers" on public.reward_tiers
  for all using (public.is_parent()) with check (public.is_parent());

-- ---- rewards ----
create table if not exists public.rewards (
  id         uuid primary key default gen_random_uuid(),
  tier_id    uuid references public.reward_tiers(id) on delete set null,   -- deleting a tier keeps its rewards (→ "Övrigt")
  title      text not null check (length(btrim(title)) > 0),
  emoji      text,
  cost_stars integer not null default 1 check (cost_stars >= 1),
  poolable   boolean not null default false,
  active     boolean not null default true,
  sort       integer not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.rewards enable row level security;
drop policy if exists "family reads rewards" on public.rewards;
create policy "family reads rewards" on public.rewards
  for select using (auth.uid() is not null);
drop policy if exists "parents manage rewards" on public.rewards;
create policy "parents manage rewards" on public.rewards
  for all using (public.is_parent()) with check (public.is_parent());

-- ---- redemptions ----
create table if not exists public.reward_redemptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  reward_id   uuid references public.rewards(id) on delete set null,       -- keep history if a reward is deleted
  cost_marks  integer not null,                                            -- snapshot of the price at redeem time
  status      text not null default 'pending' check (status in ('pending','fulfilled','cancelled')),
  created_at  timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz
);
alter table public.reward_redemptions enable row level security;
-- a kid sees only their own; parents see all. Writes go only through the functions below.
drop policy if exists "see own redemptions or parent" on public.reward_redemptions;
create policy "see own redemptions or parent" on public.reward_redemptions
  for select using (profile_id = auth.uid() or public.is_parent());

-- ============================================================ WORKFLOW FUNCTIONS

-- Kid redeems a reward: check they can afford it, reserve the streck (a negative ledger row) and
-- record a pending redemption. Reserving up-front means the balance can't be double-spent while
-- the redemption waits for a parent.
create or replace function public.request_redemption(p_reward uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rewards; cost int; bal int;
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  select * into r from public.rewards where id = p_reward and active;
  if not found then raise exception 'Belöningen finns inte'; end if;
  cost := r.cost_stars * 10;   -- 1 star = 10 streck
  select coalesce(sum(amount), 0) into bal from public.mark_ledger where profile_id = auth.uid();
  if bal < cost then raise exception 'Du har inte tillräckligt med streck'; end if;
  insert into public.reward_redemptions (profile_id, reward_id, cost_marks, status)
    values (auth.uid(), p_reward, cost, 'pending');
  insert into public.mark_ledger (profile_id, amount, reason, created_by)
    values (auth.uid(), -cost, 'Inlöst: ' || r.title, auth.uid());
end; $$;

-- Parent hands the reward over.
create or replace function public.fulfill_redemption(p_redemption uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan lösa in'; end if;
  update public.reward_redemptions set status='fulfilled', resolved_by=auth.uid(), resolved_at=now()
    where id = p_redemption and status = 'pending';
  if not found then raise exception 'Inlösen är inte öppen'; end if;
end; $$;

-- Cancel a pending redemption (a parent, or the kid who made it) and refund the reserved streck.
create or replace function public.cancel_redemption(p_redemption uuid)
returns void language plpgsql security definer set search_path = public as $$
declare red public.reward_redemptions;
begin
  update public.reward_redemptions set status='cancelled', resolved_by=auth.uid(), resolved_at=now()
    where id = p_redemption and status = 'pending'
      and (public.is_parent() or profile_id = auth.uid())
    returning * into red;
  if not found then raise exception 'Kan inte avbryta inlösen'; end if;
  insert into public.mark_ledger (profile_id, amount, reason, created_by)
    values (red.profile_id, red.cost_marks, 'Återbetalt: avbruten inlösen', auth.uid());
end; $$;

-- ============================================================ REALTIME
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='reward_tiers') then
    alter publication supabase_realtime add table public.reward_tiers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rewards') then
    alter publication supabase_realtime add table public.rewards;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='reward_redemptions') then
    alter publication supabase_realtime add table public.reward_redemptions;
  end if;
end $$;
