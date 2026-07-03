-- Slayqueens — database schema, security-first.
--
-- SECURITY MODEL (this is what makes the public anon key safe to expose):
--   * Row Level Security is ON for every table and DENIES by default.
--   * Anonymous requests (anon key, not logged in) get NOTHING.
--   * Reads are scoped to logged-in family members; kids see only their own credits.
--   * Privileged transitions (claim / submit / approve / adjust credits) go through
--     SECURITY DEFINER functions with explicit role checks — kids cannot write the
--     ledger directly, so they can never credit themselves.
--   * The secret service_role key and VAPID private key live only in server-side
--     Edge Function secrets, never in the repo.
--
-- Run this in the Supabase SQL editor. Rewards are integers in kr.

-- ============================================================ TABLES

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  role       text not null default 'kid' check (role in ('parent','kid')),
  color      text,                                  -- per-person accent for the calendar
  created_at timestamptz not null default now()
);

create table public.calendar_events (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  all_day    boolean not null default false,
  owner_id   uuid references public.profiles(id) on delete set null, -- whose name it's under; null = whole family
  notes      text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  reward        integer not null default 0 check (reward >= 0),   -- kr
  status        text not null default 'open'
                check (status in ('open','claimed','submitted','approved','rejected')),
  claimed_by    uuid references public.profiles(id) on delete set null,
  created_by    uuid not null references public.profiles(id),
  approved_by   uuid references public.profiles(id),
  reject_reason text,
  claimed_at    timestamptz,
  submitted_at  timestamptz,
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- append-only: balance = sum(amount). +earned, -paid out. Only functions write here.
create table public.credit_ledger (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount     integer not null,
  reason     text not null,
  task_id    uuid references public.tasks(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- ============================================================ HELPERS

-- SECURITY DEFINER so it reads profiles without tripping RLS recursion.
create or replace function public.is_parent()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'parent');
$$;

-- Auto-create a profile when an account is created (role defaults to 'kid';
-- promote parents manually — see the bottom of this file).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          'kid');
  return new;
end; $$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Nobody can promote themselves. A logged-in non-parent (i.e. a kid) is blocked from
-- changing any role. Server-side/admin actions have no auth.uid() (e.g. the SQL editor or
-- the service_role) and are allowed — that's how the first parent gets bootstrapped.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_parent() then
    raise exception 'Endast en förälder kan ändra roller';
  end if;
  return new;
end; $$;
create trigger guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ============================================================ RLS

alter table public.profiles           enable row level security;
alter table public.calendar_events    enable row level security;
alter table public.tasks              enable row level security;
alter table public.credit_ledger      enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles: family can read everyone (names/colors); you edit only your own row.
create policy "family reads profiles" on public.profiles
  for select using (auth.uid() is not null);
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "parents manage profiles" on public.profiles
  for update using (public.is_parent()) with check (public.is_parent());

-- calendar: everyone in the family reads; you manage your own; parents manage all.
create policy "family reads events" on public.calendar_events
  for select using (auth.uid() is not null);
create policy "create own events" on public.calendar_events
  for insert with check (created_by = auth.uid());
create policy "edit own or parent" on public.calendar_events
  for update using (created_by = auth.uid() or public.is_parent())
          with check (created_by = auth.uid() or public.is_parent());
create policy "delete own or parent" on public.calendar_events
  for delete using (created_by = auth.uid() or public.is_parent());

-- tasks: family reads; only parents create/edit/delete jobs. Kids change status
-- only via the functions below (claim/submit) — never by direct UPDATE.
create policy "family reads tasks" on public.tasks
  for select using (auth.uid() is not null);
create policy "parents create tasks" on public.tasks
  for insert with check (public.is_parent() and created_by = auth.uid());
create policy "parents edit tasks" on public.tasks
  for update using (public.is_parent()) with check (public.is_parent());
create policy "parents delete tasks" on public.tasks
  for delete using (public.is_parent());

-- ledger: a kid sees only their own; parents see all. NO write policy on purpose —
-- only the SECURITY DEFINER functions insert rows.
create policy "see own ledger or parent" on public.credit_ledger
  for select using (profile_id = auth.uid() or public.is_parent());

-- push subs: you manage only your own device rows.
create policy "manage own subs" on public.push_subscriptions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ============================================================ WORKFLOW FUNCTIONS

create or replace function public.claim_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  update public.tasks set status='claimed', claimed_by=auth.uid(), claimed_at=now()
    where id = p_task and status = 'open';
  if not found then raise exception 'Uppgiften går inte att plocka'; end if;
end; $$;

create or replace function public.submit_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.tasks set status='submitted', submitted_at=now()
    where id = p_task and claimed_by = auth.uid() and status in ('claimed','rejected');
  if not found then raise exception 'Kan inte lämna in uppgiften'; end if;
end; $$;

create or replace function public.approve_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t public.tasks;
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan godkänna'; end if;
  update public.tasks set status='approved', approved_by=auth.uid(), approved_at=now()
    where id = p_task and status = 'submitted' returning * into t;
  if not found then raise exception 'Uppgiften är inte inlämnad'; end if;
  insert into public.credit_ledger (profile_id, amount, reason, task_id, created_by)
    values (t.claimed_by, t.reward, 'Godkänt: ' || t.title, t.id, auth.uid());
end; $$;

create or replace function public.reject_task(p_task uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan neka'; end if;
  update public.tasks set status='rejected', reject_reason=p_reason
    where id = p_task and status = 'submitted';
  if not found then raise exception 'Uppgiften är inte inlämnad'; end if;
end; $$;

-- Parent-only manual credit / payout (negative amount = paid out in cash).
create or replace function public.adjust_credits(p_profile uuid, p_amount int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan justera'; end if;
  insert into public.credit_ledger (profile_id, amount, reason, created_by)
    values (p_profile, p_amount, p_reason, auth.uid());
end; $$;

-- Balance per person; runs with the caller's RLS so a kid sees only their own.
create view public.balances
  with (security_invoker = on) as
  select profile_id, coalesce(sum(amount), 0)::int as balance
  from public.credit_ledger group by profile_id;
grant select on public.balances to authenticated;

-- ============================================================ REALTIME
-- Let the front end receive live updates for these tables (drives instant
-- refresh across everyone's phones). RLS still applies to what each user gets.
alter publication supabase_realtime add table
  public.calendar_events, public.tasks, public.credit_ledger, public.profiles;

-- ============================================================ ONE-TIME SETUP
-- After you create your own account, promote it to parent:
--   update public.profiles set role = 'parent'
--   where id = (select id from auth.users where email = 'YOUR_EMAIL');

-- ============================================================ ADDITIONS 2026-07-03
-- Abort a claimed/rejected job → returns it to the open list.
create or replace function public.abort_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.tasks
    set status='open', claimed_by=null, claimed_at=null, submitted_at=null, reject_reason=null
    where id = p_task and claimed_by = auth.uid() and status in ('claimed','rejected');
  if not found then raise exception 'Kan inte avbryta uppgiften'; end if;
end; $$;

-- Kids request a payout; parents approve (pays out) or decline.
create table if not exists public.payout_requests (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  amount      integer not null check (amount > 0),
  status      text not null default 'pending' check (status in ('pending','paid','declined')),
  created_at  timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz
);
alter table public.payout_requests enable row level security;
drop policy if exists "see own payout or parent" on public.payout_requests;
create policy "see own payout or parent" on public.payout_requests
  for select using (profile_id = auth.uid() or public.is_parent());

create or replace function public.request_payout(p_amount int)
returns void language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Ogiltigt belopp'; end if;
  select coalesce(sum(amount),0) into bal from public.credit_ledger where profile_id = auth.uid();
  if p_amount > bal then raise exception 'Beloppet överstiger ditt saldo'; end if;
  if exists (select 1 from public.payout_requests where profile_id = auth.uid() and status='pending') then
    raise exception 'Du har redan en väntande begäran';
  end if;
  insert into public.payout_requests(profile_id, amount) values (auth.uid(), p_amount);
end; $$;

create or replace function public.resolve_payout(p_request uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.payout_requests;
begin
  if not public.is_parent() then raise exception 'Endast en förälder kan hantera begäran'; end if;
  update public.payout_requests
    set status = case when p_approve then 'paid' else 'declined' end,
        resolved_by = auth.uid(), resolved_at = now()
    where id = p_request and status = 'pending'
    returning * into r;
  if not found then raise exception 'Begäran är redan hanterad'; end if;
  if p_approve then
    insert into public.credit_ledger(profile_id, amount, reason, created_by)
    values (r.profile_id, -r.amount, 'Utbetalt', auth.uid());
  end if;
end; $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='payout_requests') then
    alter publication supabase_realtime add table public.payout_requests;
  end if;
end $$;

-- ============================================================ ADDITIONS 2026-07-03b
-- Job templates: reusable presets parents tap to activate onto the board.
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

-- ============================================================ ADDITIONS 2026-07-03c
-- Private events + event categories.
alter table public.calendar_events add column if not exists private  boolean not null default false;
alter table public.calendar_events add column if not exists category text;

drop policy if exists "family reads events" on public.calendar_events;
create policy "family reads events" on public.calendar_events
  for select using (
    not private or created_by = auth.uid() or owner_id = auth.uid() or public.is_parent()
  );

-- ============================================================ ADDITIONS 2026-07-03d
-- Event suggestions + 👍/👎 voting.
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
