-- ======================================================= SKOLLUNCH 2026-08-16
-- The school's lunch menu, shown under the school schedule on the landing screen. The whole
-- family eats at the same school, so this is ONE menu per date (not per child).
--
--   school_meals  one row per date, `courses` = that day's dishes (huvudrätt, vegetariskt, …).
--                 Family-read. NO write policy on purpose: rows are written by the
--                 `school-menu` edge function using the service role (which bypasses RLS),
--                 so nothing in the app — not even a parent — can corrupt the fetched menu.
--
-- `app_settings.school_menu_id` holds the skolmaten.se identifier the fetcher uses (the slug
-- from the school's URL, e.g. 'stromsnasskolan', or its UUID if the slug isn't accepted).
-- Idempotent: safe to run (or re-run) on the live database.

create table if not exists public.school_meals (
  id         uuid primary key default gen_random_uuid(),
  date       date not null unique,
  courses    text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.school_meals enable row level security;
drop policy if exists "family reads school meals" on public.school_meals;
create policy "family reads school meals" on public.school_meals
  for select using (auth.uid() is not null);

-- Which school to fetch. Default = the slug in https://skolmaten.se/<slug>.
alter table public.app_settings add column if not exists school_menu_id text default 'stromsnasskolan';

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='school_meals') then
    alter publication supabase_realtime add table public.school_meals;
  end if;
end $$;
