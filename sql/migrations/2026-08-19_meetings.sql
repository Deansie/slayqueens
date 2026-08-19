-- ================================================= MÖTEN 2026-08-19
-- Known meeting / busy blocks, so a family calendar event that collides gets a soft heads-up
-- ("Krockar med …") before it's saved — with ±15 min headroom. The point: one adult works from
-- home with scheduled meetings the other can't see when booking things (a doctor's appointment,
-- etc.). The meetings are kept here by hand (the work Google calendar has no shareable feed).
--
--   meetings   two kinds in one table:
--                • recurring weekly  → weekday 0=Mon … 6=Sun, date NULL (repeats every week)
--                • one-off           → a specific date, weekday NULL
--              Parent-managed, family-read. Times are plain local clock times.
-- Idempotent: safe to run (or re-run) on the live database.

-- Supersedes the short-lived work_hours experiment (broad daily blocks) — drop it if it exists.
drop table if exists public.work_hours cascade;

create table if not exists public.meetings (
  id         uuid primary key default gen_random_uuid(),
  title      text,                                               -- optional label, e.g. 'Standup'
  weekday    smallint check (weekday between 0 and 6),           -- recurring; NULL for a one-off
  date       date,                                               -- one-off; NULL for recurring
  start_time time not null,
  end_time   time not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint meetings_kind  check ((weekday is null) <> (date is null)),   -- exactly one of the two
  constraint meetings_times check (end_time > start_time)
);
alter table public.meetings enable row level security;
-- Everyone signed in reads (the collision check runs on every device); parents maintain the list.
drop policy if exists "family reads meetings" on public.meetings;
create policy "family reads meetings" on public.meetings
  for select using (auth.uid() is not null);
drop policy if exists "parents manage meetings" on public.meetings;
create policy "parents manage meetings" on public.meetings
  for all using (public.is_parent()) with check (public.is_parent());

-- Live sync so a change on one device reflects on the others.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='meetings') then
    alter publication supabase_realtime add table public.meetings;
  end if;
end $$;
