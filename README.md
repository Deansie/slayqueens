# Slayqueens

A small family web app: a shared calendar for everyone's important dates, and a
chore board where the kids pick jobs to earn credit (kr) — with a parent approving
each finished job before any credit is paid. Built as an installable PWA so it
works like an app on a phone, including push notifications.

It reuses the spirit of the family budget app: a static, no-build front end
(plain HTML/CSS/JS, libraries from a CDN), Swedish interface, automatic light/dark
theme. The difference is that this app is genuinely shared between several people,
so its data lives in a small [Supabase](https://supabase.com) backend instead of
one person's OneDrive.

## Keys & security — why the public repo is fine

The front end ships with a Supabase **anon (publishable) key**. That key is
**public by design** — it is meant to run in the browser, and committing it is
expected (exactly like the budget app commits its MSAL client ID). A key the
browser uses cannot be hidden anyway; making the repo private would not help,
because the key is served to every visitor's device.

What actually protects the data:

- **Row Level Security on every table, default-deny.** Anonymous requests get
  nothing; each logged-in family member sees only what the policies allow (a kid
  sees only their own credits; only a parent can approve). See `sql/schema.sql`.
- **Privileged actions are locked behind functions.** Claiming, submitting,
  approving and adjusting credits go through `SECURITY DEFINER` functions with
  role checks, so a kid can never write the ledger and credit themselves.
- **Public sign-ups are disabled**, so nobody on the internet can make an account
  against the public key — parents create the accounts.
- **The real secrets never touch the repo.** The `service_role` key and the VAPID
  *private* key live only as Supabase Edge Function secrets on the server.

## Supabase setup checklist

1. Create a free Supabase project (an EU region is nice for a Swedish family).
2. **Authentication → Providers/Settings:** turn **off** "Allow new users to sign
   up", and turn **off** email confirmation (so parent-created kid accounts work
   without the kids needing a real inbox).
3. **SQL editor:** run `sql/schema.sql`.
4. Create the family's accounts under **Authentication → Users** (any unique email
   works, e.g. `alice@slayqueens.local`). A profile row is created automatically.
5. Promote the parent account(s) — the last lines of `sql/schema.sql` show the one
   SQL statement to run.
6. **Settings → API:** copy the **Project URL** and the **anon/publishable key**
   into `scripts/config.js`.

## Project structure

```
index.html          Page shell
manifest.json       PWA manifest (installable, "Add to Home Screen")
sw.js               Service worker (receives push, offline shell)
styles/             CSS, split by concern, native nesting, design tokens
scripts/
  config.js         Public Supabase URL + anon key + VAPID public key
  supa.js           Supabase client + auth/session helpers
  auth.js           Login screen and role gating
  state.js          In-memory state + realtime subscriptions
  calendar.js       Family calendar
  tasks.js          Chore board (create / claim / submit / approve)
  credits.js        Balances and ledger history
  push.js           Notification permission + subscription
  toast.js          Toast notifications
  main.js           View routing and startup
sql/schema.sql      Tables, RLS policies, workflow functions
supabase/functions/ Edge function that sends web push
```
