# Slayqueens

A small family web app with a dark, editorial look: a date-first shared calendar,
a to-do list, a chore board where the kids pick jobs to earn credit (kr) — a parent
approving each finished job before any credit is paid — an ideas/voting board, and
a **parents-only household budget**. Built as an installable PWA so it works like an
app on a phone, including push notifications.

Navigation is a bottom tab bar — **Kalender · Att göra · Jobb · Idéer · Budget**
(Budget shows for parents only) — while each person's **Poäng** (credit balance,
history, payouts), profile colour, notifications and the light/dark switch live in
the profile menu behind the "me" pill. The header shows today's date, a live count
of today's/tomorrow's events, and the local weather.

It reuses the spirit of the family budget app: a static, no-build front end
(plain HTML/CSS/JS, libraries from a CDN), Swedish interface, light/dark theme. The
difference is that this app is genuinely shared between several people, so its data
lives in a small [Supabase](https://supabase.com) backend instead of one person's
OneDrive — and the budget itself has been ported here, swapping OneDrive for a
parents-only Supabase table.

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
3. **SQL editor:** run `sql/schema.sql`, then each file in `sql/migrations/` in
   filename order (they are additive — the latest, `2026-07-05b_budget.sql`, adds
   the parents-only budget table).
4. Create the family's accounts under **Authentication → Users** (any unique email
   works, e.g. `alice@slayqueens.local`). A profile row is created automatically.
5. Promote the parent account(s) — the last lines of `sql/schema.sql` show the one
   SQL statement to run.
6. **Settings → API:** copy the **Project URL** and the **anon/publishable key**
   into `scripts/config.js`. While there, set `WEATHER_LAT`/`WEATHER_LON` to your
   town (or set `WEATHER_ENABLED: false` to hide the weather widget).

### Budget & weather

- **Budget (parents only).** Ported from the standalone budget app; the whole
  document lives as JSON in a single-row `budget` table whose RLS only lets parents
  read or write it — kids never see the family's finances. Saves do a
  read-merge-write keyed on each month's timestamp, and realtime keeps both parents'
  devices in sync (the same merge model the OneDrive version used, minus OneDrive).
- **Weather.** The header widget uses the free, keyless [Open-Meteo](https://open-meteo.com)
  API. It stays hidden until a reading arrives and hides itself again on any error,
  so the app never looks broken offline.

## Project structure

```
index.html          Page shell (header, views, bottom nav, FAB, dialogs)
manifest.json       PWA manifest (installable, "Add to Home Screen")
sw.js               Service worker (receives push)
styles/             CSS, split by concern, design tokens (dark + light)
  base.css          Tokens, reset, typography (display serif + system sans)
  layout.css        App shell, header, bottom nav, FAB, profile menu
  components.css    Cards, chips, avatars, filter, day headers, lists
  budget.css        Budget UI (scoped under .budget)
  overlays.css      Toasts and dialogs
scripts/
  config.js         Public Supabase URL + anon key + VAPID + weather location
  supa.js           Supabase client + auth/session helpers
  auth.js           Login screen and role gating
  state.js          In-memory state + realtime subscriptions
  header.js         Date header + today's/tomorrow's event counts
  weather.js        Header weather widget (Open-Meteo)
  calendar.js       Family calendar (day-grouped cards)
  tasks.js          Chore board (create / claim / submit / approve)
  credits.js        Poäng — balances and ledger history
  suggestions.js    Idéer — proposals + voting
  todos.js          Att göra — shared + private to-do list
  chat.js           Comment threads (events / jobs / ideas)
  profile.js        Profile colour + push toggle
  budget.js         Budget (parents only), Supabase-backed
  theme.js          Light/dark switch
  push.js           Notification permission + subscription
  toast.js          Toasts (incl. undo action)
  main.js           View routing, FAB, profile menu, startup
sql/schema.sql      Tables, RLS policies, workflow functions
sql/migrations/     Additive migrations (latest adds the budget table)
supabase/functions/ Edge function that sends web push
```
