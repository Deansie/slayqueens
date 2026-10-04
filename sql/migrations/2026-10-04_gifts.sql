-- ================================================ JULKLAPPAR 2026-10-04
-- A gift list only the parents can see: planned presents per kid, with an optional price and a
-- Köpt tick, so gifts never show up (or get crossed out) on the kids' own lists in Inköp. In the
-- app it's reached by holding "Inköp" for 4 seconds and entering a code, so a kid scrolling a
-- parent's phone doesn't stumble on it. The code is chosen in the app the first time it's
-- opened and only its SHA-256 hash is stored here, so the code itself is never in this repo.
--
--   gifts          one row per planned present: recipient (a kid), title, price (kr, optional),
--                  bought, year (the Christmas it's for), from_wish (copied from a wish in Inköp).
--   gift_settings  a single row holding the code's hash. Forgot the code? Run
--                    update public.gift_settings set code_hash = null;
--                  and the next open asks for a new one.
-- Parents only, for everything: a kid's account gets no access at all.
-- Idempotent: safe to run (or re-run) on the live database.

create table if not exists public.gifts (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title        text not null check (length(btrim(title)) > 0),
  price        integer check (price is null or price >= 0),
  bought       boolean not null default false,
  year         smallint not null default extract(year from now())::smallint,
  from_wish    boolean not null default false,
  created_by   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index if not exists gifts_year_idx on public.gifts (year);
alter table public.gifts enable row level security;
drop policy if exists "parents only gifts" on public.gifts;
create policy "parents only gifts" on public.gifts
  for all using (public.is_parent()) with check (public.is_parent());

create table if not exists public.gift_settings (
  id         boolean primary key default true check (id),
  code_hash  text,
  updated_at timestamptz not null default now()
);
alter table public.gift_settings enable row level security;
drop policy if exists "parents only gift settings" on public.gift_settings;
create policy "parents only gift settings" on public.gift_settings
  for all using (public.is_parent()) with check (public.is_parent());
insert into public.gift_settings (id) values (true) on conflict (id) do nothing;

-- Live sync between the two parents' phones (RLS: kids receive nothing).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='gifts') then
    alter publication supabase_realtime add table public.gifts;
  end if;
end $$;
