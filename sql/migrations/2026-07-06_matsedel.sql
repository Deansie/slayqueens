-- ============================================================ MATSEDEL 2026-07-06
-- Veckans matsedel — a weekly dinner plan (one dish per day), managed by parents, with a
-- reusable library of the family's regular dishes ("Rätter") and kid meal-wishes.
--
--   meals        the plan itself: one row per date (unique). Family reads; parents write.
--   meal_dishes  a flat library of dishes the family eats. Parents pick from it when
--                planning a day, and it grows as they plan. Family reads; parents write.
--   meal_wishes  dishes anyone (incl. kids) would like; parents pull them into a day.

create table if not exists public.meals (
  id         uuid primary key default gen_random_uuid(),
  date       date not null unique,               -- one dinner per day
  title      text not null,
  note       text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.meals enable row level security;
drop policy if exists "family reads meals" on public.meals;
create policy "family reads meals" on public.meals
  for select using (auth.uid() is not null);
drop policy if exists "parents manage meals" on public.meals;
create policy "parents manage meals" on public.meals
  for all using (public.is_parent()) with check (public.is_parent());

-- The plan uses a flat dish library (not a fixed weekly template); drop the old idea if a
-- previous version of this migration created it.
drop table if exists public.meal_templates cascade;

create table if not exists public.meal_dishes (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(btrim(title)) > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.meal_dishes enable row level security;
drop policy if exists "family reads dishes" on public.meal_dishes;
create policy "family reads dishes" on public.meal_dishes
  for select using (auth.uid() is not null);
drop policy if exists "parents manage dishes" on public.meal_dishes;
create policy "parents manage dishes" on public.meal_dishes
  for all using (public.is_parent()) with check (public.is_parent());

create table if not exists public.meal_wishes (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(btrim(title)) > 0),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.meal_wishes enable row level security;
drop policy if exists "family reads wishes" on public.meal_wishes;
create policy "family reads wishes" on public.meal_wishes
  for select using (auth.uid() is not null);
drop policy if exists "create own wish" on public.meal_wishes;
create policy "create own wish" on public.meal_wishes
  for insert with check (created_by = auth.uid());
drop policy if exists "delete own wish or parent" on public.meal_wishes;
create policy "delete own wish or parent" on public.meal_wishes
  for delete using (created_by = auth.uid() or public.is_parent());

-- Live sync for everyone (RLS still applies to what each person receives).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='meals') then
    alter publication supabase_realtime add table public.meals;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='meal_dishes') then
    alter publication supabase_realtime add table public.meal_dishes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='meal_wishes') then
    alter publication supabase_realtime add table public.meal_wishes;
  end if;
end $$;
