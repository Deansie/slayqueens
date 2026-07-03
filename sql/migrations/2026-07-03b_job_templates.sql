-- Slayqueens — additions 2026-07-03b: job templates (reusable presets parents activate).
-- Idempotent: safe to run once on the existing database.

create table if not exists public.task_templates (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  reward      integer not null default 0 check (reward >= 0),
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);
alter table public.task_templates enable row level security;
drop policy if exists "parents manage templates" on public.task_templates;
create policy "parents manage templates" on public.task_templates
  for all using (public.is_parent()) with check (public.is_parent());

do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='task_templates') then
    alter publication supabase_realtime add table public.task_templates;
  end if;
end $$;
