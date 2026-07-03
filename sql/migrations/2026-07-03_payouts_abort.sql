-- Slayqueens — additions 2026-07-03: abort a job + kid-requested payouts.
-- Idempotent: safe to run once on the existing database.

-- 1) Abort a claimed/rejected job → returns it to the open list.
create or replace function public.abort_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.tasks
    set status='open', claimed_by=null, claimed_at=null, submitted_at=null, reject_reason=null
    where id = p_task and claimed_by = auth.uid() and status in ('claimed','rejected');
  if not found then raise exception 'Kan inte avbryta uppgiften'; end if;
end; $$;

-- 2) Kids request a payout; parents approve (pays out) or decline.
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
-- writes happen only through the functions below

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

-- realtime for the new table
do $$ begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='payout_requests') then
    alter publication supabase_realtime add table public.payout_requests;
  end if;
end $$;
