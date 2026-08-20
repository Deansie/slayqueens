-- ===================================================== SECURITY FIX 2026-08-20
-- Restore the "must be a logged-in family member" gate on the read/update policies that
-- silently lost it. THIS CLOSES AN UNAUTHENTICATED DATA-EXPOSURE HOLE — run it now.
--
-- THE BUG
--   When private events (2026-07-03c), to-dos (2026-07-04) and shopping (2026-07-09) were
--   added, their SELECT policies were written in the shape
--       using (not private       or <owner/parent checks>)     -- events, todos
--       using (owner_id is null   or <owner/parent checks>)     -- shopping categories
--   For a NON-private / shared row the leading clause is literally TRUE, so the whole policy
--   passes even when auth.uid() IS NULL — i.e. for a request that carries only the public
--   anon key and is NOT logged in. The anon key ships in the public repo, so in practice:
--     • every non-private calendar_events row  (title, notes, dates, creator/owner ids)
--     • every shared todos row
--     • every shared shopping_topics row + its shopping_items
--   were readable by anyone on the internet, and shared todos / shopping_items were also
--   UPDATE-able by them (the update policies share the same clause). Verified 2026-08-20 with
--   an unauthenticated REST read against the live project.
--
-- THE FIX
--   Require a logged-in user FIRST, then apply the original visibility rule:
--       using (auth.uid() is not null and (<original rule>))
--   Private / owner-only rows were never exposed (they don't take the TRUE branch), and every
--   logged-in family member keeps exactly the access they had — this only removes the
--   anonymous path. Idempotent: safe to run once on the live database (SQL editor → redeploy).

-- 1) calendar events: read -----------------------------------------------------
drop policy if exists "family reads events" on public.calendar_events;
create policy "family reads events" on public.calendar_events
  for select using (
    auth.uid() is not null
    and (not private or created_by = auth.uid() or owner_id = auth.uid() or public.is_parent())
  );

-- 2) to-dos: read + update -----------------------------------------------------
drop policy if exists "read shared or own todos" on public.todos;
create policy "read shared or own todos" on public.todos
  for select using (
    auth.uid() is not null
    and (not private or owner_id = auth.uid() or public.is_parent())
  );

drop policy if exists "update shared or own todos" on public.todos;
create policy "update shared or own todos" on public.todos
  for update using (
    auth.uid() is not null
    and (not private or owner_id = auth.uid() or public.is_parent())
  ) with check (
    auth.uid() is not null
    and (not private or owner_id = auth.uid() or public.is_parent())
  );
-- (The todos INSERT policy already gates on created_by = auth.uid(), which anon can't satisfy,
--  so it needs no change.)

-- 3) shopping categories: read ------------------------------------------------
drop policy if exists "read own or shared shopping topics" on public.shopping_topics;
create policy "read own or shared shopping topics" on public.shopping_topics
  for select using (
    auth.uid() is not null
    and (owner_id is null or owner_id = auth.uid() or public.is_parent())
  );

-- 4) shopping ITEMS inherit their visibility from the category through this SECURITY DEFINER
--    helper, which carried the same missing gate. Fixing it here re-secures shopping_items'
--    read / insert / update policies AND the 'shopping' comment-thread visibility (both call it).
create or replace function public.can_see_shopping_topic(p_topic uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.shopping_topics t
    where t.id = p_topic
      and (t.owner_id is null or t.owner_id = auth.uid() or public.is_parent())
  );
$$;

-- 5) defense in depth: can_see_event has the same latent `not private` shape. Today it is only
--    reached behind can_see_message_parent, which has its own auth.uid() gate, so it is NOT
--    currently exploitable — but harden it so a future caller can't reopen the hole.
create or replace function public.can_see_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.calendar_events e
    where e.id = p_event
      and (not e.private or e.created_by = auth.uid() or e.owner_id = auth.uid() or public.is_parent())
  );
$$;
