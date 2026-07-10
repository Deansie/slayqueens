-- ============================================================ MARKS (STRECK) 2026-07-10
-- Everyday behaviour rewards, in "marks" (Swedish UI: "streck"). 10 marks = 1 star ("stjärna").
-- Distinct from the Jobb board (which earns real money in credit_ledger): marks are a virtual,
-- non-cash currency the kids spend in a reward shop (a later migration adds the shop + goals).
-- Everything is parent-editable. Every mark is gated: a kid ticks a routine → a pending request
-- → a parent approves and only then do marks land in the ledger. Parents can also award marks
-- directly (a bonus / spot award). All crediting goes through SECURITY DEFINER functions so a
-- kid can never self-credit — same guarantee as the job workflow.
--
--   behaviors      the editable library: routines a kid ticks off + bonuses a parent awards,
--                  each worth some marks. Parents manage; the family reads.
--   mark_ledger    append-only; balance = sum(amount). Read own + parent. No write policy —
--                  only the functions below insert rows.
--   mark_requests  a kid's "I did this routine" awaiting a parent's approval.
-- Idempotent: safe to run (or re-run) on the existing database (SQL editor → redeploy).

-- ---- library ----
create table if not exists public.behaviors (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(btrim(title)) > 0),
  marks          integer not null default 1 check (marks >= 0),
  kind           text not null default 'routine' check (kind in ('routine','bonus')),
  needs_approval boolean not null default true,      -- kept per-row so a trusted routine can auto-credit later
  active         boolean not null default true,
  sort           integer not null default 0,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
alter table public.behaviors enable row level security;
drop policy if exists "family reads behaviors" on public.behaviors;
create policy "family reads behaviors" on public.behaviors
  for select using (auth.uid() is not null);
drop policy if exists "parents manage behaviors" on public.behaviors;
create policy "parents manage behaviors" on public.behaviors
  for all using (public.is_parent()) with check (public.is_parent());

-- ---- ledger ----
create table if not exists public.mark_ledger (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  amount      integer not null,                                          -- + earned, - spent (future shop)
  reason      text not null,
  behavior_id uuid references public.behaviors(id) on delete set null,   -- keep history if a behavior is deleted
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
alter table public.mark_ledger enable row level security;
-- a kid sees only their own; parents see all. NO write policy — only the functions below insert.
drop policy if exists "see own marks or parent" on public.mark_ledger;
create policy "see own marks or parent" on public.mark_ledger
  for select using (profile_id = auth.uid() or public.is_parent());

-- ---- requests ----
create table if not exists public.mark_requests (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  behavior_id uuid not null references public.behaviors(id) on delete cascade,
  amount      integer not null,                                          -- snapshot of the behavior's marks at submit
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz
);
alter table public.mark_requests enable row level security;
-- a kid sees only their own; parents see all. Kids change status only via the functions below.
drop policy if exists "see own mark requests or parent" on public.mark_requests;
create policy "see own mark requests or parent" on public.mark_requests
  for select using (profile_id = auth.uid() or public.is_parent());

-- ---- balance view ----
-- Marks per person; runs with the caller's RLS so a kid sees only their own.
create or replace view public.mark_balances
  with (security_invoker = on) as
  select profile_id, coalesce(sum(amount), 0)::int as marks
  from public.mark_ledger group by profile_id;
grant select on public.mark_balances to authenticated;

-- ============================================================ WORKFLOW FUNCTIONS

-- A kid taps a routine as done. Normally this is gated (a pending request a parent approves);
-- if a routine is ever set to auto (needs_approval = false), the marks are credited straight away.
create or replace function public.submit_marks(p_behavior uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b public.behaviors;
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  select * into b from public.behaviors where id = p_behavior and active and kind = 'routine';
  if not found then raise exception 'Rutinen finns inte'; end if;
  if exists (select 1 from public.mark_requests
              where behavior_id = p_behavior and profile_id = auth.uid() and status = 'pending') then
    raise exception 'Redan inskickad';
  end if;
  if b.needs_approval then
    insert into public.mark_requests (profile_id, behavior_id, amount)
      values (auth.uid(), p_behavior, b.marks);
  else
    insert into public.mark_ledger (profile_id, amount, reason, behavior_id, created_by)
      values (auth.uid(), b.marks, b.title, p_behavior, auth.uid());
  end if;
end; $$;

-- Parent approves a pending request → the marks land in the ledger.
create or replace function public.approve_marks(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.mark_requests; b public.behaviors;
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan godkänna'; end if;
  update public.mark_requests set status='approved', resolved_by=auth.uid(), resolved_at=now()
    where id = p_request and status = 'pending' returning * into r;
  if not found then raise exception 'Begäran är inte öppen'; end if;
  select * into b from public.behaviors where id = r.behavior_id;
  insert into public.mark_ledger (profile_id, amount, reason, behavior_id, created_by)
    values (r.profile_id, r.amount, coalesce(b.title, 'Rutin'), r.behavior_id, auth.uid());
end; $$;

create or replace function public.reject_marks(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan neka'; end if;
  update public.mark_requests set status='rejected', resolved_by=auth.uid(), resolved_at=now()
    where id = p_request and status = 'pending';
  if not found then raise exception 'Begäran är inte öppen'; end if;
end; $$;

-- Parent awards marks directly (a bonus / spot award, or a manual correction if negative).
-- p_behavior is optional and only used to keep the history tidy.
create or replace function public.award_marks(p_profile uuid, p_amount int, p_reason text, p_behavior uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan ge streck'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'Ange antal streck'; end if;
  insert into public.mark_ledger (profile_id, amount, reason, behavior_id, created_by)
    values (p_profile, p_amount, coalesce(nullif(btrim(p_reason), ''), 'Bonus'), p_behavior, auth.uid());
end; $$;

-- ============================================================ REALTIME
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='behaviors') then
    alter publication supabase_realtime add table public.behaviors;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='mark_ledger') then
    alter publication supabase_realtime add table public.mark_ledger;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='mark_requests') then
    alter publication supabase_realtime add table public.mark_requests;
  end if;
end $$;
