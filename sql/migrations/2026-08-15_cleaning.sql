-- ========================================================= STÄDSCHEMA 2026-08-15
-- A recurring weekly cleaning schedule inside "Att göra" (beside Att göra + Inköp). Parents
-- set up tasks pinned to a weekday; the whole family ticks them off through the week so the
-- work doesn't pile up for the weekend. Completions are tracked PER WEEK, so the schedule
-- resets automatically every Monday.
--
--   cleaning_tasks  the recurring schedule. One row per chore, pinned to a weekday
--                   (0 = Monday … 6 = Sunday). Family-read, parent-write. Shared — no owner.
--   cleaning_done   one row per (task, week) when it's ticked. week_start = that week's Monday
--                   (a date). Anyone in the family can tick or untick.
-- Idempotent: safe to run (or re-run) on the existing database (SQL editor → redeploy).

create table if not exists public.cleaning_tasks (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(btrim(title)) > 0),
  weekday    smallint not null check (weekday between 0 and 6),   -- 0 = Monday … 6 = Sunday
  sort       integer not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.cleaning_tasks enable row level security;
-- Everyone in the family reads the schedule; only parents create / edit / delete tasks.
drop policy if exists "family reads cleaning tasks" on public.cleaning_tasks;
create policy "family reads cleaning tasks" on public.cleaning_tasks
  for select using (auth.uid() is not null);
drop policy if exists "parents manage cleaning tasks" on public.cleaning_tasks;
create policy "parents manage cleaning tasks" on public.cleaning_tasks
  for all using (public.is_parent()) with check (public.is_parent());

create table if not exists public.cleaning_done (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.cleaning_tasks(id) on delete cascade,
  week_start date not null,                                       -- Monday of the week ticked
  done_by    uuid not null references public.profiles(id),
  done_at    timestamptz not null default now(),
  unique (task_id, week_start)
);
alter table public.cleaning_done enable row level security;
-- Shared: anyone in the family sees completions, ticks (as themselves), and can untick.
drop policy if exists "family reads cleaning done" on public.cleaning_done;
create policy "family reads cleaning done" on public.cleaning_done
  for select using (auth.uid() is not null);
drop policy if exists "family ticks cleaning done" on public.cleaning_done;
create policy "family ticks cleaning done" on public.cleaning_done
  for insert with check (done_by = auth.uid());
drop policy if exists "family unticks cleaning done" on public.cleaning_done;
create policy "family unticks cleaning done" on public.cleaning_done
  for delete using (auth.uid() is not null);

-- Live sync for everyone.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cleaning_tasks') then
    alter publication supabase_realtime add table public.cleaning_tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cleaning_done') then
    alter publication supabase_realtime add table public.cleaning_done;
  end if;
end $$;
