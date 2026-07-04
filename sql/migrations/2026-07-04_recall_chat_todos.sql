-- Slayqueens — additions 2026-07-04: recall a claimed job, per-event chat, and to-do lists.
-- Idempotent: safe to run once on the existing database (SQL editor → redeploy).

-- ============================================================ RECALL A JOB
-- Parent takes a claimed job back from a kid → returns it to the open list.
create or replace function public.recall_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan återkalla'; end if;
  update public.tasks
    set status='open', claimed_by=null, claimed_at=null, submitted_at=null, reject_reason=null
    where id = p_task and status in ('claimed','submitted','rejected');
  if not found then raise exception 'Uppgiften kan inte återkallas'; end if;
end; $$;

-- ============================================================ EVENT CHAT
-- SECURITY DEFINER visibility helper — mirrors the "family reads events" policy without
-- re-triggering RLS on calendar_events inside another table's policy subquery.
create or replace function public.can_see_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.calendar_events e
    where e.id = p_event
      and (not e.private or e.created_by = auth.uid() or e.owner_id = auth.uid() or public.is_parent())
  );
$$;

create table if not exists public.event_messages (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.calendar_events(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);
alter table public.event_messages enable row level security;

drop policy if exists "read messages on visible events" on public.event_messages;
create policy "read messages on visible events" on public.event_messages
  for select using (public.can_see_event(event_id));
drop policy if exists "post messages on visible events" on public.event_messages;
create policy "post messages on visible events" on public.event_messages
  for insert with check (author_id = auth.uid() and public.can_see_event(event_id));
drop policy if exists "delete own message or parent" on public.event_messages;
create policy "delete own message or parent" on public.event_messages
  for delete using (author_id = auth.uid() or public.is_parent());

-- ============================================================ TO-DO LISTS
-- Shared (private=false, owner_id null): the whole family sees + checks off.
-- Private (private=true, owner_id = the person): only that person (+ parents) — same
-- "hidden from the other kids" meaning as a private calendar event.
create table if not exists public.todos (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(btrim(title)) > 0),
  done       boolean not null default false,
  private    boolean not null default false,
  owner_id   uuid references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  done_at    timestamptz,
  done_by    uuid references public.profiles(id)
);
alter table public.todos enable row level security;

drop policy if exists "read shared or own todos" on public.todos;
create policy "read shared or own todos" on public.todos
  for select using (not private or owner_id = auth.uid() or public.is_parent());
drop policy if exists "create todos" on public.todos;
create policy "create todos" on public.todos
  for insert with check (created_by = auth.uid() and (not private or owner_id = auth.uid()));
drop policy if exists "update shared or own todos" on public.todos;
create policy "update shared or own todos" on public.todos
  for update using (not private or owner_id = auth.uid() or public.is_parent())
          with check (not private or owner_id = auth.uid() or public.is_parent());
drop policy if exists "delete own todo or parent" on public.todos;
create policy "delete own todo or parent" on public.todos
  for delete using (created_by = auth.uid() or owner_id = auth.uid() or public.is_parent());

-- ============================================================ REALTIME
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='event_messages') then
    alter publication supabase_realtime add table public.event_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='todos') then
    alter publication supabase_realtime add table public.todos;
  end if;
end $$;
