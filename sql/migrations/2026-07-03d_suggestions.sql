-- Slayqueens — additions 2026-07-03d: event suggestions + 👍/👎 voting.
-- Idempotent: safe to run once on the existing database.

create table if not exists public.event_suggestions (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  notes      text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.event_suggestions enable row level security;
drop policy if exists "family reads suggestions" on public.event_suggestions;
create policy "family reads suggestions" on public.event_suggestions
  for select using (auth.uid() is not null);
drop policy if exists "create own suggestion" on public.event_suggestions;
create policy "create own suggestion" on public.event_suggestions
  for insert with check (created_by = auth.uid());
drop policy if exists "delete own suggestion or parent" on public.event_suggestions;
create policy "delete own suggestion or parent" on public.event_suggestions
  for delete using (created_by = auth.uid() or public.is_parent());

create table if not exists public.suggestion_votes (
  id            uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.event_suggestions(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  vote          smallint not null check (vote in (-1, 1)),
  created_at    timestamptz not null default now(),
  unique (suggestion_id, profile_id)
);
alter table public.suggestion_votes enable row level security;
drop policy if exists "family reads votes" on public.suggestion_votes;
create policy "family reads votes" on public.suggestion_votes
  for select using (auth.uid() is not null);
drop policy if exists "manage own vote" on public.suggestion_votes;
create policy "manage own vote" on public.suggestion_votes
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='event_suggestions') then
    alter publication supabase_realtime add table public.event_suggestions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='suggestion_votes') then
    alter publication supabase_realtime add table public.suggestion_votes;
  end if;
end $$;
