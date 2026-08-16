-- ============================================ SKOLLUNCH FETCH SCHEDULE 2026-08-16
-- Keeps public.school_meals fresh by calling the `school-menu` edge function, which pulls the
-- week's lunches from skolmaten.se. Runs nightly; each run refreshes this week + next.
--
-- Same shared-secret plumbing as the cleaning nudge: the URL and secret come from Vault, so
-- nothing sensitive lands in this public repo. If you already ran
-- `2026-08-15_cleaning_reminder.sql`, both Vault secrets exist and the setup below is done.
--
-- ── ONE-TIME SETUP (only if you have NOT already done it for the cleaning nudge) ────────────
--   select vault.create_secret('https://<your-project-ref>.functions.supabase.co', 'edge_functions_url');
--   select vault.create_secret('<paste-a-long-random-string>',                     'cron_secret');
--   -- then set the same string as a function secret:
--   --   npx supabase secrets set CRON_SECRET=<same string> --project-ref <ref>
--
-- Deploy the function first:
--   npx supabase functions deploy school-menu --project-ref <ref> --no-verify-jwt
-- Re-running this migration is safe (it reschedules).

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('school-menu-fetch');
exception when others then
  null;   -- not scheduled yet
end $$;

-- 03:30 UTC — quiet hours, and well before anyone opens the app in the morning.
select cron.schedule(
  'school-menu-fetch',
  '30 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_url') || '/school-menu',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := jsonb_build_object('weeks', 2)
  );
  $$
);

-- Handy for a first run / debugging (paste into the SQL editor, it fires immediately):
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_url') || '/school-menu',
--     headers := jsonb_build_object('Content-Type','application/json',
--                                   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
--     body := jsonb_build_object('weeks', 2));
