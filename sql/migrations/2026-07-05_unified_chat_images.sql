-- Slayqueens — additions 2026-07-05: one chat system for events + jobs + suggestions,
-- with (heavily downscaled) image attachments stored in a public Storage bucket.
-- Idempotent. Run AFTER 2026-07-04 (it folds that batch's event_messages table into the
-- new unified messages table and drops it). Safe to run whether or not event_messages exists.

-- ------------------------------------------------------------ unified messages
-- context tells us which parent the thread hangs off; parent_id is that row's id.
-- No polymorphic FK is possible, so parent existence is checked in can_see_message_parent
-- and (for events) visibility follows can_see_event so private-event threads stay hidden.
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  context    text not null check (context in ('event','task','suggestion')),
  parent_id  uuid not null,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text,
  image_path text,                                   -- path within the 'chat' Storage bucket
  created_at timestamptz not null default now(),
  check (coalesce(btrim(body), '') <> '' or image_path is not null)
);

-- can_see_event already exists from 2026-07-04; (re)create defensively in case only this
-- migration is run against an older database.
create or replace function public.can_see_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.calendar_events e
    where e.id = p_event
      and (not e.private or e.created_by = auth.uid() or e.owner_id = auth.uid() or public.is_parent())
  );
$$;

-- A logged-in family member may see a thread if its parent is visible to them: events use
-- the private-aware rule; jobs and suggestions are family-wide (must still exist).
create or replace function public.can_see_message_parent(p_context text, p_parent uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and case
    when p_context = 'event'      then public.can_see_event(p_parent)
    when p_context = 'task'       then exists (select 1 from public.tasks where id = p_parent)
    when p_context = 'suggestion' then exists (select 1 from public.event_suggestions where id = p_parent)
    else false
  end;
$$;

alter table public.messages enable row level security;
drop policy if exists "read messages" on public.messages;
create policy "read messages" on public.messages
  for select using (public.can_see_message_parent(context, parent_id));
drop policy if exists "post messages" on public.messages;
create policy "post messages" on public.messages
  for insert with check (author_id = auth.uid() and public.can_see_message_parent(context, parent_id));
drop policy if exists "delete own message or parent" on public.messages;
create policy "delete own message or parent" on public.messages
  for delete using (author_id = auth.uid() or public.is_parent());

-- ------------------------------------------------------------ fold in event_messages
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'event_messages') then
    insert into public.messages (id, context, parent_id, author_id, body, created_at)
      select id, 'event', event_id, author_id, body, created_at from public.event_messages
      on conflict (id) do nothing;
    begin
      alter publication supabase_realtime drop table public.event_messages;
    exception when others then null;
    end;
    drop table public.event_messages;
  end if;
end $$;

-- ------------------------------------------------------------ image storage
-- Public bucket: unguessable random filenames; readable by URL, writable only by the
-- logged-in family, deletable by the uploader or a parent. Client downscales before upload.
insert into storage.buckets (id, name, public)
  values ('chat', 'chat', true)
  on conflict (id) do nothing;

drop policy if exists "chat read" on storage.objects;
create policy "chat read" on storage.objects
  for select using (bucket_id = 'chat');
drop policy if exists "chat upload" on storage.objects;
create policy "chat upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat');
drop policy if exists "chat delete" on storage.objects;
create policy "chat delete" on storage.objects
  for delete to authenticated using (bucket_id = 'chat' and (owner = auth.uid() or public.is_parent()));

-- ------------------------------------------------------------ realtime
do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
