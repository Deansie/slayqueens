-- Slayqueens — additions 2026-07-03c: private events + event categories.
-- Idempotent: safe to run once on the existing database.

alter table public.calendar_events add column if not exists private  boolean not null default false;
alter table public.calendar_events add column if not exists category text;

-- Private events are hidden from other kids; the creator, the person it's for, and
-- parents can still see them.
drop policy if exists "family reads events" on public.calendar_events;
create policy "family reads events" on public.calendar_events
  for select using (
    not private or created_by = auth.uid() or owner_id = auth.uid() or public.is_parent()
  );
