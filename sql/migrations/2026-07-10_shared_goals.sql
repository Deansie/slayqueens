-- ============================================================ FAMILJEMÅL (SHARED GOALS) 2026-07-10
-- Phase 3 of the streck system: pooling. A poolable ("delbar") reward can be turned into a shared
-- family goal that the kids chip streck into together — so several kids can join their points into
-- something bigger (a trip to the tivoli, say). The target is the reward's tier cost in stars.
-- Contributing spends the kid's streck (a negative mark_ledger row) and is withdrawable until the
-- goal is fulfilled; once the pot reaches the target a parent fulfils it (everyone gets the reward)
-- or cancels it (everyone is refunded).
--
--   point_goals         one active goal per poolable reward; snapshots the title/emoji/target so it
--                       stays stable even if the reward is later edited or deleted.
--   goal_contributions  each kid's streck put toward a goal (sum = progress; visible to the family).
-- Run AFTER 2026-07-10_rewards.sql (+ its tier-cost patch) — goals reference rewards, reward_tiers
-- and mark_ledger. The filename sorts after the rewards migrations on purpose. Idempotent.

create table if not exists public.point_goals (
  id           uuid primary key default gen_random_uuid(),
  reward_id    uuid references public.rewards(id) on delete set null,   -- snapshot below keeps the goal usable if the reward goes away
  title        text not null,
  emoji        text,
  target_marks integer not null check (target_marks > 0),
  status       text not null default 'active' check (status in ('active','reached','fulfilled','cancelled')),
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  resolved_by  uuid references public.profiles(id),
  resolved_at  timestamptz
);
alter table public.point_goals enable row level security;
drop policy if exists "family reads goals" on public.point_goals;
create policy "family reads goals" on public.point_goals
  for select using (auth.uid() is not null);
-- writes go only through the functions below.

create table if not exists public.goal_contributions (
  id         uuid primary key default gen_random_uuid(),
  goal_id    uuid not null references public.point_goals(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  marks      integer not null check (marks > 0),
  created_at timestamptz not null default now()
);
alter table public.goal_contributions enable row level security;
-- the whole family sees who chipped in (it's a cooperative goal); writes go through the functions.
drop policy if exists "family reads contributions" on public.goal_contributions;
create policy "family reads contributions" on public.goal_contributions
  for select using (auth.uid() is not null);

-- ============================================================ WORKFLOW FUNCTIONS

-- Parent starts a goal from a poolable reward; the target is that reward's tier cost in streck.
create or replace function public.create_goal(p_reward uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rewards; tier_stars int;
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan starta ett mål'; end if;
  select * into r from public.rewards where id = p_reward and active and poolable;
  if not found then raise exception 'Belöningen kan inte delas'; end if;
  if exists (select 1 from public.point_goals where reward_id = p_reward and status in ('active','reached')) then
    raise exception 'Det finns redan ett mål för den';
  end if;
  select stars into tier_stars from public.reward_tiers where id = r.tier_id;
  if tier_stars is null then raise exception 'Belöningen saknar nivå'; end if;
  insert into public.point_goals (reward_id, title, emoji, target_marks, status, created_by)
    values (p_reward, r.title, r.emoji, tier_stars * 10, 'active', auth.uid());
end; $$;

-- A kid puts streck into a goal (capped at what's still needed). Filling it flips it to 'reached'.
create or replace function public.contribute_goal(p_goal uuid, p_marks int)
returns void language plpgsql security definer set search_path = public as $$
declare g public.point_goals; progress int; remaining int; bal int; give int;
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  if p_marks is null or p_marks <= 0 then raise exception 'Ange hur mycket du vill bidra'; end if;
  select * into g from public.point_goals where id = p_goal;
  if not found or g.status not in ('active','reached') then raise exception 'Målet är inte öppet'; end if;
  select coalesce(sum(marks), 0) into progress from public.goal_contributions where goal_id = p_goal;
  remaining := g.target_marks - progress;
  if remaining <= 0 then raise exception 'Målet är redan fullt'; end if;
  give := least(p_marks, remaining);
  select coalesce(sum(amount), 0) into bal from public.mark_ledger where profile_id = auth.uid();
  if bal < give then raise exception 'Du har inte tillräckligt med streck'; end if;
  insert into public.goal_contributions (goal_id, profile_id, marks) values (p_goal, auth.uid(), give);
  insert into public.mark_ledger (profile_id, amount, reason, created_by)
    values (auth.uid(), -give, 'Bidrag: ' || g.title, auth.uid());
  if progress + give >= g.target_marks then
    update public.point_goals set status = 'reached' where id = p_goal and status = 'active';
  end if;
end; $$;

-- A contributor takes their streck back out (allowed until the goal is fulfilled). Dropping below
-- the target reverts a 'reached' goal to 'active'.
create or replace function public.withdraw_goal(p_goal uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g public.point_goals; mine int;
begin
  select * into g from public.point_goals where id = p_goal;
  if not found or g.status not in ('active','reached') then raise exception 'Går inte att ta tillbaka'; end if;
  select coalesce(sum(marks), 0) into mine from public.goal_contributions
    where goal_id = p_goal and profile_id = auth.uid();
  if mine <= 0 then raise exception 'Du har inte bidragit'; end if;
  delete from public.goal_contributions where goal_id = p_goal and profile_id = auth.uid();
  insert into public.mark_ledger (profile_id, amount, reason, created_by)
    values (auth.uid(), mine, 'Återtaget bidrag: ' || g.title, auth.uid());
  update public.point_goals set status = 'active'
    where id = p_goal and status = 'reached'
      and (select coalesce(sum(marks), 0) from public.goal_contributions where goal_id = p_goal) < g.target_marks;
end; $$;

-- Parent cashes the goal in (only once it's full). The streck were already spent on contributing.
create or replace function public.fulfill_goal(p_goal uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan lösa in'; end if;
  update public.point_goals set status = 'fulfilled', resolved_by = auth.uid(), resolved_at = now()
    where id = p_goal and status = 'reached';
  if not found then raise exception 'Målet är inte fullt än'; end if;
end; $$;

-- Parent cancels a goal and refunds every contributor.
create or replace function public.cancel_goal(p_goal uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan avbryta'; end if;
  if not exists (select 1 from public.point_goals where id = p_goal and status in ('active','reached')) then
    raise exception 'Målet går inte att avbryta';
  end if;
  for c in select gc.profile_id, sum(gc.marks) as m, pg.title as title
             from public.goal_contributions gc join public.point_goals pg on pg.id = gc.goal_id
             where gc.goal_id = p_goal group by gc.profile_id, pg.title loop
    insert into public.mark_ledger (profile_id, amount, reason, created_by)
      values (c.profile_id, c.m, 'Återbetalt: avbrutet mål ' || c.title, auth.uid());
  end loop;
  delete from public.goal_contributions where goal_id = p_goal;
  update public.point_goals set status = 'cancelled', resolved_by = auth.uid(), resolved_at = now()
    where id = p_goal;
end; $$;

-- ============================================================ REALTIME
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='point_goals') then
    alter publication supabase_realtime add table public.point_goals;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='goal_contributions') then
    alter publication supabase_realtime add table public.goal_contributions;
  end if;
end $$;
