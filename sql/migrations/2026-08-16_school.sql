-- ============================================================= SKOLA 2026-08-16
-- Per-child school schedules. A recurring weekly base (each child's ordinary school hours +
-- an optional subject/activity per weekday), plus per-date overrides for exceptions (a lov/
-- studiedag with no school, or a one-off change of times/activity). Parents set it up from the
-- profile-menu "Skola" view; the family reads it, and the landing screen surfaces today's rows.
--
--   school_weekly     recurring base. One row per (child, weekday), 0 = Monday … 6 = Sunday.
--                     start_time/end_time = ordinary hours; activity = subject chip (nullable).
--   school_overrides  per-date exceptions. no_school = day off; otherwise the given fields
--                     override that date's weekly base (nullable fields fall back to the base).
-- Both family-read, parent-write. Idempotent: safe to run (or re-run) on the live database.

create table if not exists public.school_weekly (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references public.profiles(id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6),   -- 0 = Monday … 6 = Sunday
  start_time time not null,
  end_time   time not null,
  activity   text,                                                -- subject chip, e.g. 'gympa'
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (child_id, weekday)
);
alter table public.school_weekly enable row level security;
drop policy if exists "family reads school weekly" on public.school_weekly;
create policy "family reads school weekly" on public.school_weekly
  for select using (auth.uid() is not null);
drop policy if exists "parents manage school weekly" on public.school_weekly;
create policy "parents manage school weekly" on public.school_weekly
  for all using (public.is_parent()) with check (public.is_parent());

create table if not exists public.school_overrides (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references public.profiles(id) on delete cascade,
  date       date not null,
  no_school  boolean not null default false,                      -- lov / studiedag
  start_time time,
  end_time   time,
  activity   text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (child_id, date)
);
alter table public.school_overrides enable row level security;
drop policy if exists "family reads school overrides" on public.school_overrides;
create policy "family reads school overrides" on public.school_overrides
  for select using (auth.uid() is not null);
drop policy if exists "parents manage school overrides" on public.school_overrides;
create policy "parents manage school overrides" on public.school_overrides
  for all using (public.is_parent()) with check (public.is_parent());

-- Live sync for everyone.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='school_weekly') then
    alter publication supabase_realtime add table public.school_weekly;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='school_overrides') then
    alter publication supabase_realtime add table public.school_overrides;
  end if;
end $$;
