-- ============================================== HEMMA / KONTOR 2026-10-04
-- A small per-day marker for where a parent works that day: 🏠 hemma or 🏢 på kontoret. A parent
-- taps the date in the Kalender week to cycle their own marker (🏠 → 🏢 → none); the rest of the
-- family sees it as a small tag on that day.
--
--   work_days   one row per (person, date). location = 'home' | 'office'; no row = not set.
--               Family-read; each parent writes only their own days.
-- Idempotent: safe to run (or re-run) on the live database.

create table if not exists public.work_days (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  date       date not null,
  location   text not null check (location in ('home', 'office')),
  created_at timestamptz not null default now(),
  unique (profile_id, date)
);
alter table public.work_days enable row level security;

-- Everyone signed in reads. Keep the auth.uid() gate: the anon key is public (2026-08-20 fix).
drop policy if exists "family reads work days" on public.work_days;
create policy "family reads work days" on public.work_days
  for select using (auth.uid() is not null);

-- A parent sets (and clears) only their own days.
drop policy if exists "parents manage own work days" on public.work_days;
create policy "parents manage own work days" on public.work_days
  for all using (profile_id = auth.uid() and public.is_parent())
  with check (profile_id = auth.uid() and public.is_parent());

-- Live sync so a marker set on one phone shows on the others.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='work_days') then
    alter publication supabase_realtime add table public.work_days;
  end if;
end $$;
