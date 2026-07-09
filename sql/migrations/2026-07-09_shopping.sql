-- ============================================================ INKÖP 2026-07-09
-- A shopping-needs board inside "Att göra". Parents create dynamic categories and assign each
-- to a person (or leave it shared) — e.g. "Kläder" for one kid. A kid only sees the categories
-- assigned to them plus shared ones, and adds what they need there; parents see everything.
-- Category ownership (not per-item) drives visibility: owner_id null = shared/family.
--
--   shopping_topics  the categories, each owned by a person or shared. Parents manage them;
--                    a kid reads their own + shared. owner_id null = shared/family.
--   shopping_items   what's missing under a category. Visibility is inherited from the
--                    category (via can_see_shopping_topic); anyone who sees a category adds to it.
-- Idempotent: safe to run (or re-run) on the existing database (SQL editor → redeploy).

create table if not exists public.shopping_topics (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(btrim(title)) > 0),
  emoji      text,
  owner_id   uuid references public.profiles(id) on delete cascade,   -- who it's for; null = shared/family
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
-- add owner_id if an earlier version created the table without it
alter table public.shopping_topics add column if not exists owner_id uuid references public.profiles(id) on delete cascade;
alter table public.shopping_topics enable row level security;
-- Read: a kid sees their own + shared categories; parents see all.
drop policy if exists "family reads shopping topics" on public.shopping_topics;
drop policy if exists "read own or shared shopping topics" on public.shopping_topics;
create policy "read own or shared shopping topics" on public.shopping_topics
  for select using (owner_id is null or owner_id = auth.uid() or public.is_parent());
-- Only parents create / rename / reassign / delete categories.
drop policy if exists "parents manage shopping topics" on public.shopping_topics;
create policy "parents manage shopping topics" on public.shopping_topics
  for all using (public.is_parent()) with check (public.is_parent());

create table if not exists public.shopping_items (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references public.shopping_topics(id) on delete cascade,
  title      text not null check (length(btrim(title)) > 0),
  bought     boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  bought_at  timestamptz,
  bought_by  uuid references public.profiles(id)
);
alter table public.shopping_items enable row level security;

-- An item's visibility is inherited from its category. SECURITY DEFINER so this check doesn't
-- re-trigger RLS on shopping_topics from inside shopping_items' policies (same trick as
-- can_see_event) — mirrors "a kid sees their own + shared categories".
create or replace function public.can_see_shopping_topic(p_topic uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.shopping_topics t
    where t.id = p_topic
      and (t.owner_id is null or t.owner_id = auth.uid() or public.is_parent())
  );
$$;

-- Ownership moved from the item to the category; drop the old per-item column + its policies if
-- a previous version of this migration created them (drop policies first — they reference it).
drop policy if exists "family reads shopping items" on public.shopping_items;
drop policy if exists "read own or shared shopping items" on public.shopping_items;
drop policy if exists "read items in visible topics" on public.shopping_items;
drop policy if exists "create own shopping item" on public.shopping_items;
drop policy if exists "create shopping item" on public.shopping_items;
drop policy if exists "add items to visible topics" on public.shopping_items;
drop policy if exists "family ticks shopping items" on public.shopping_items;
drop policy if exists "tick visible shopping items" on public.shopping_items;
drop policy if exists "tick items in visible topics" on public.shopping_items;
drop policy if exists "delete own shopping item or parent" on public.shopping_items;
alter table public.shopping_items drop column if exists owner_id;

-- Read / add / tick: anyone who can see the category. Delete: the item's creator or a parent.
create policy "read items in visible topics" on public.shopping_items
  for select using (public.can_see_shopping_topic(topic_id));
create policy "add items to visible topics" on public.shopping_items
  for insert with check (created_by = auth.uid() and public.can_see_shopping_topic(topic_id));
create policy "tick items in visible topics" on public.shopping_items
  for update using (public.can_see_shopping_topic(topic_id))
          with check (public.can_see_shopping_topic(topic_id));
create policy "delete own shopping item or parent" on public.shopping_items
  for delete using (created_by = auth.uid() or public.is_parent());

-- Live sync for everyone (RLS still applies to what each person receives).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shopping_topics') then
    alter publication supabase_realtime add table public.shopping_topics;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shopping_items') then
    alter publication supabase_realtime add table public.shopping_items;
  end if;
end $$;
