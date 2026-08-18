-- ================================================ SKOLA · LEDIGA DAGAR 2026-08-18
-- Family-wide school closures (lov, studiedagar, klämdagar): ONE shared list that closes school
-- for ALL kids at once, instead of adding a per-child avvikelse for each of them. It behaves like
-- a röd dag — any date inside a closure is a non-school day for everyone — but a per-child
-- avvikelse for that exact date still wins (so a single kid can e.g. have a make-up day in a lov).
-- Parents manage it from the profile-menu "Skola" view; the whole family reads it. Idempotent.
--
--   school_closures  one row per closed period. end_date null = a single day (= start_date).
--                    label is free text ('Höstlov', 'Studiedag', …). No per-person owner — it is
--                    family-wide, so created_by is only a light audit trail and may be null.

create table if not exists public.school_closures (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  start_date date not null,
  end_date   date,                                    -- null = single day (= start_date)
  created_by uuid references public.profiles(id),     -- nullable: closures aren't personal
  created_at timestamptz not null default now(),
  unique (label, start_date),                         -- lets the seed below re-run safely
  check (end_date is null or end_date >= start_date)
);
alter table public.school_closures enable row level security;
drop policy if exists "family reads school closures" on public.school_closures;
create policy "family reads school closures" on public.school_closures
  for select using (auth.uid() is not null);
drop policy if exists "parents manage school closures" on public.school_closures;
create policy "parents manage school closures" on public.school_closures
  for all using (public.is_parent()) with check (public.is_parent());

-- Live sync for everyone.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='school_closures') then
    alter publication supabase_realtime add table public.school_closures;
  end if;
end $$;

-- Seed the 2026/2027 school-year lediga dagar (Grundskola & gymnasieskola). The public holidays
-- that already close school (Långfredag, Kristi himmelsfärds dag, …) are computed in code as röda
-- dagar and are intentionally NOT repeated here. Jullov ends the day before vårterminen börjar
-- (måndag 11 jan) so that first day back is still counted as school.
-- Sommarlov starts the day after vårterminen slutar (12 jun); its end (autumn 2027's term start)
-- isn't published yet, so it's seeded with an assumed 17 aug 2027 that a parent can adjust later.
insert into public.school_closures (label, start_date, end_date) values
  ('Studiedag', '2026-09-23', null),
  ('Höstlov',   '2026-10-26', '2026-10-30'),
  ('Studiedag', '2026-11-24', null),
  ('Jullov',    '2026-12-21', '2027-01-10'),
  ('Sportlov',  '2027-02-22', '2027-02-26'),
  ('Studiedag', '2027-03-16', null),
  ('Påsklov',   '2027-03-29', '2027-04-02'),
  ('Klämdag',   '2027-05-07', null),
  ('Sommarlov', '2027-06-12', '2027-08-17')
on conflict (label, start_date) do nothing;
