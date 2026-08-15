-- ============================================ IN-APP REMINDER TIME 2026-08-15
-- Make the daily cleaning-reminder time adjustable from the app (parents → profile dialog)
-- instead of editing the cron schedule. The cron now fires HOURLY; the notify function checks
-- this settings row and only sends when the current Europe/Stockholm hour matches (DST-safe).
--
-- Run this after 2026-08-15_cleaning_reminder.sql, then redeploy notify (--no-verify-jwt).
-- Idempotent.

create table if not exists public.app_settings (
  id                        boolean primary key default true check (id),   -- singleton row
  cleaning_reminder_enabled boolean not null default true,
  cleaning_reminder_hour    smallint not null default 8 check (cleaning_reminder_hour between 0 and 23)
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
-- Everyone reads the household settings; only parents change them.
drop policy if exists "family reads settings" on public.app_settings;
create policy "family reads settings" on public.app_settings
  for select using (auth.uid() is not null);
drop policy if exists "parents change settings" on public.app_settings;
create policy "parents change settings" on public.app_settings
  for all using (public.is_parent()) with check (public.is_parent());

-- Live sync so a time change on one device reflects on the others.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='app_settings') then
    alter publication supabase_realtime add table public.app_settings;
  end if;
end $$;

-- Reschedule the nudge to run hourly; the function decides whether it's the configured hour.
do $$
begin
  perform cron.unschedule('cleaning-daily-nudge');
exception when others then
  null;
end $$;

select cron.schedule(
  'cleaning-daily-nudge',
  '0 * * * *',   -- top of every hour (UTC); the function gates on the app-set Stockholm hour
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_url') || '/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := jsonb_build_object('type', 'cleaning_digest')
  );
  $$
);
