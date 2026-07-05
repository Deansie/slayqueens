-- ============================================================ BUDGET 2026-07-05
-- Parents-only household budget, ported from the standalone budget app so the family
-- can plan income/expenses month-by-month inside Slayqueens instead of OneDrive.
--
-- One shared JSON document per family (mirrors the old single budget.json): the month /
-- income / expense / group shape is preserved verbatim in a JSONB column, so the ported
-- UI reads and writes it unchanged. A singleton row keeps it to exactly one document.
--
-- SECURITY: only parents can read OR write. Kids never see the family's finances —
-- the RLS below denies them entirely (no policy grants a non-parent anything here).

create table if not exists public.budget (
  id         boolean primary key default true check (id),        -- singleton: id is always true
  data       jsonb not null default '{"months":{}}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.budget enable row level security;

drop policy if exists "parents read budget" on public.budget;
create policy "parents read budget" on public.budget
  for select using (public.is_parent());

drop policy if exists "parents write budget" on public.budget;
create policy "parents write budget" on public.budget
  for all using (public.is_parent()) with check (public.is_parent());

-- Seed the singleton so the first save UPDATEs an existing row (empty, harmless).
insert into public.budget (id, data) values (true, '{"months":{}}'::jsonb)
  on conflict (id) do nothing;

-- Live sync between the two parents' devices. RLS still applies, so only parents get it.
do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='budget') then
    alter publication supabase_realtime add table public.budget;
  end if;
end $$;
