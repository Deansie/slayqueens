-- ================================================ STÄDSCHEMA DAILY NUDGE 2026-08-15
-- A once-a-day push reminder to parents about the cleaning that's due today / overdue this
-- week. pg_cron fires an HTTP call (pg_net) to the `notify` edge function, which computes the
-- counts and sends the push (type 'cleaning_digest', parents only, silent when nothing's due).
--
-- The cron call authenticates to the function with a shared secret (the function has no user
-- JWT to verify here). Both the function base URL and the secret are read from **Vault**, so
-- NOTHING sensitive is committed to this public repo.
--
-- ── ONE-TIME SETUP (run once in the SQL editor, with your own values) ───────────────────────
--   -- 1. store the function base URL + a long random secret in Vault:
--   select vault.create_secret('https://<your-project-ref>.functions.supabase.co', 'edge_functions_url');
--   select vault.create_secret('<paste-a-long-random-string>',                     'cron_secret');
--   -- 2. set the SAME random string as a function secret so notify can check it:
--   --    Dashboard → Edge Functions → notify → Secrets → add CRON_SECRET = <same string>
--   --    (or: npx supabase secrets set CRON_SECRET=<same string> --project-ref <ref>)
-- Then run this migration. Re-running is safe (it reschedules).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace any previous schedule so this file is idempotent.
do $$
begin
  perform cron.unschedule('cleaning-daily-nudge');
exception when others then
  null;   -- not scheduled yet
end $$;

-- 06:00 UTC ≈ 08:00 Europe/Stockholm in summer, 07:00 in winter.
select cron.schedule(
  'cleaning-daily-nudge',
  '0 6 * * *',
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
