-- ================================================== LÄXOR 2026-10-04
-- The kids' homework as quick reminders on Dagens agenda (a row inside the Skola card). Homework
-- has no schedule: it's added the day before it's due (+ Läxa on the start screen, the next school
-- day pre-picked), ticked when done, and a ticked one stays crossed out until its day is over.
--
--   homework   one row per läxa: kid_id (who it's for), title, due_date, done_at / done_by.
--              Family-read. A parent adds for any kid, a kid adds their own. Ticking: a parent or
--              the kid. Deleting: a parent or whoever added it.
-- Idempotent: safe to run (or re-run) on the live database.

create table if not exists public.homework (
  id         uuid primary key default gen_random_uuid(),
  kid_id     uuid not null references public.profiles(id) on delete cascade,
  title      text not null check (length(btrim(title)) > 0),
  due_date   date not null,
  done_at    timestamptz,
  done_by    uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists homework_due_idx on public.homework (due_date);
alter table public.homework enable row level security;

-- Everyone signed in reads. Keep the auth.uid() gate: the anon key is public (2026-08-20 fix).
drop policy if exists "family reads homework" on public.homework;
create policy "family reads homework" on public.homework
  for select using (auth.uid() is not null);

-- A parent adds homework for any kid; a kid adds their own.
drop policy if exists "add homework" on public.homework;
create policy "add homework" on public.homework
  for insert with check (created_by = auth.uid() and (public.is_parent() or kid_id = auth.uid()));

-- Ticking (and fixing a typo): a parent, or the kid it belongs to.
drop policy if exists "tick homework" on public.homework;
create policy "tick homework" on public.homework
  for update using (public.is_parent() or kid_id = auth.uid())
  with check (public.is_parent() or kid_id = auth.uid());

drop policy if exists "delete homework" on public.homework;
create policy "delete homework" on public.homework
  for delete using (public.is_parent() or created_by = auth.uid());

-- Live sync so a läxa added or ticked on one phone shows on the others.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='homework') then
    alter publication supabase_realtime add table public.homework;
  end if;
end $$;
