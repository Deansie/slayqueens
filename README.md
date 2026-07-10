# Slayqueens

A private web app for running a family: a shared calendar, a chore board where the kids
earn pocket money, shared and personal to-do lists, an ideas board the family votes on, a
weekly meal plan, and a parents-only household budget, all in one installable app with a
dark, magazine-style look. The interface is in Swedish and money is in kronor.

It installs to the phone's home screen as a PWA (so it behaves like a native app and can
send push notifications), everything syncs live between everyone's devices, and each person
signs in with their own account. Parents and kids see different things: kids can't see the
family finances, can't approve their own chores, and can't credit themselves.

## What it does

**Kalender.** The family's shared calendar. Upcoming events are grouped by day (*Idag*,
*Imorgon*, then by weekday), each tagged with a category (Aktiviteter, Skola, Familj, Hälsa,
Kalas, Annat) and with whose it is: a family member or the whole family. Events can be timed
or all-day, carry an optional note, and be marked **private** (hidden from the other kids,
still visible to parents). An event happening right now shows a *Pågår* badge. The header
shows today's date, a count of today's and tomorrow's events, and the local weather.

**Att göra.** A to-do list and a shopping board, switched with a toggle at the top of the
page. The **to-do list** has a shared family checklist anyone can tick off, plus each person's
own private to-dos. **Inköp** is a shopping-needs board: parents create categories ("Kläder",
"Skolsaker"…) and assign each to a person or leave it shared. A category is private to whoever
it's for, so a kid only sees the categories assigned to them (plus shared ones) and fills in
what they need there; parents see everyone's — handy with several kids. Parents tick things off
as they shop.

**Sysslor.** Two boards behind a segmented toggle: **Jobb** and **Rutiner**.

*Jobb* is the chore board. Parents post jobs with a reward in kronor (and can save recurring
ones as reusable templates). A kid picks a job, does it, and marks it done; a parent then
approves it (which pays out the reward) or rejects it with a reason. Parents can also recall
a job, or a kid can release one they no longer want.

*Rutiner* rewards everyday good behaviour with *streck* (10 streck = 1 ⭐ stjärna) — a virtual
currency, separate from the Jobb board's real money. Parents keep an editable library of
routines a kid ticks off (bädda sängen, läxa i tid…) and bonuses a parent hands out for things
like a whole day without sibling squabbles. Every streck is gated: a kid tapping a routine
creates a request a parent approves, and only then do the streck land. Balances show as stars
plus a five-bar tally of progress toward the next one.

**Belöningar.** The reward shop where kids spend streck (reached from the profile menu). Parents
build an editable set of tiers (Små / Mellan / Stora…) and rewards priced in stars — glass, extra
skärmtid, a trip to the playground, up to big shared treats. A kid redeems a reward they can
afford (which reserves the streck), and a parent marks it handed over or cancels it (refunding
the streck). Rewards can be flagged *delbar* for the planned Familjemål pooling.

**Poäng.** Pocket-money accounts. Every approved job adds to the kid's balance. Kids see their
balance and history and can request a payout; parents see everyone's balances, approve
payouts, and make manual adjustments. (Reached from the profile menu rather than the tab bar.)

**Idéer.** Suggestions. Anyone proposes something to do together, the family votes it up or
down, and a parent can turn a popular idea into a real calendar event.

**Matsedel.** The weekly meal plan, laid out like a menu card with the week number and ‹ › to
move between weeks. Parents fill the week by picking from a growing library of the family's
regular dishes ("Rätter"); kids add *önskemål* (dishes they'd like) that parents can drop into
a day, and a wish clears itself once it's on the menu so they don't pile up.

**Budget.** The household budget (parents only). Plan income and expenses one month at a time,
group related items (e.g. all loans under "Lån"), and see totals, a savings rate, and where
the money goes. Kids never see it.

**Comments and photos.** Events, jobs, ideas, and shopping categories each have a comment
thread, with optional image attachments (handy for sorting out sizes and specifics). The
calendar shows a banner pointing to the newest comment so a new message never gets missed.

**Notifications, weather, and themes.** Opt-in push notifications for new jobs, approvals,
payouts, comments, a new shopping list assigned to you, and more. A weather widget whose location each device chooses. A light or
dark theme, and a personal colour per person shown as an avatar throughout the app.

## How it's built

A static front end: plain HTML, CSS, and JavaScript with **no build step and no framework**.
The only things loaded from a CDN are the Supabase client and the display font. Everything
else is served exactly as it sits in this repo.

The backend is [Supabase](https://supabase.com):

- **Postgres + Row Level Security** for all data. RLS is default-deny, so anonymous requests
  get nothing and each signed-in person only sees what they're allowed to (a kid sees only
  their own credits; only parents see the budget). Privileged actions (claiming, approving,
  and adjusting credits) go through `SECURITY DEFINER` database functions, so a kid can never
  write the ledger directly.
- **Auth** (email + password) with a `role` of `parent` or `kid` on each profile that drives
  all of the above.
- **Realtime** so changes appear on everyone's devices instantly.
- **Storage** for comment-thread images.
- **One Edge Function** (`notify`) that sends the web-push notifications.

It installs as a PWA via `manifest.json` and a small service worker (`sw.js`) that receives
push messages.

## Set it up for yourself

You'll need a (free) Supabase project and somewhere to host static files. No server to run.

### 1. Create the Supabase project

Create a project (an EU region is nice for a Swedish family). Then under
**Authentication → Sign In / Providers**:

- **Turn OFF "Allow new users to sign up".** Parents create the accounts; nobody on the
  internet should be able to register.
- **Turn OFF email confirmation**, so parent-made kid accounts work without the kids needing
  a real inbox.

### 2. Create the database

In the **SQL editor**, run:

1. `sql/schema.sql`: the base tables, RLS policies, and workflow functions.
2. Then each file in `sql/migrations/`, **oldest first** by the date in the filename. They're
   additive and idempotent, so re-running or overlaps are harmless:

   ```
   2026-07-03_payouts_abort.sql
   2026-07-03b_job_templates.sql
   2026-07-03c_event_private_categories.sql
   2026-07-03d_suggestions.sql
   2026-07-04_recall_chat_todos.sql
   2026-07-05_unified_chat_images.sql        (also creates the "chat" Storage bucket)
   2026-07-05b_budget.sql
   2026-07-06_matsedel.sql
   2026-07-09_shopping.sql
   ```

   If the SQL editor refuses to create the Storage policies in the chat migration, create a
   **public** bucket named `chat` in **Storage** in the dashboard and add the equivalent
   read/insert/delete policies from that file by hand.

### 3. Create accounts and pick the parents

- Under **Authentication → Users → Add user**, add one user per family member (any unique
  email works, e.g. `alice@slayqueens.local`, plus a password). A profile row is created
  automatically, defaulting to the `kid` role.
- **Promote your parent account(s)** in the SQL editor:

  ```sql
  update public.profiles set role = 'parent'
  where id = (select id from auth.users where email = 'YOUR_EMAIL');
  ```

- Names aren't editable in the app; set nice display names in SQL if you like:

  ```sql
  update public.profiles set name = 'Alice' where id = (select id from auth.users where email = 'alice@slayqueens.local');
  ```

  (Each person picks their own colour inside the app.)

### 4. Point the front end at your project

Open **Settings → API** in Supabase and copy your **Project URL** and **anon / publishable
key** into `scripts/config.js`:

```js
const CONFIG = {
  SUPABASE_URL:      'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
  VAPID_PUBLIC_KEY:  'YOUR-VAPID-PUBLIC-KEY',   // for push (see step 5)
  WEATHER_ENABLED:   true,
  WEATHER_LAT:       56.833,                    // first-run default only; each device
  WEATHER_LON:       13.941,                    // can change it in the app
  WEATHER_LABEL:     'Ljungby'
};
```

The anon key is **meant to live in the browser** and is safe to commit, because RLS and auth
are what protect your data, not hiding this key. Never put the `service_role` key or the VAPID
*private* key in the repo (see step 5).

### 5. Push notifications (optional, recommended)

1. Generate a VAPID key pair:

   ```sh
   npx web-push generate-vapid-keys
   ```

2. Put the **public** key in `scripts/config.js` (`VAPID_PUBLIC_KEY` above).
3. Set the function's secrets (dashboard **Edge Functions → Secrets**, or the CLI). The
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are provided automatically, so you only add:

   ```sh
   npx supabase secrets set \
     VAPID_PUBLIC_KEY=YOUR-VAPID-PUBLIC-KEY \
     VAPID_PRIVATE_KEY=YOUR-VAPID-PRIVATE-KEY \
     VAPID_SUBJECT=mailto:you@example.com \
     --project-ref YOUR-PROJECT-REF
   ```

4. Deploy the function **with JWT verification off** (the function verifies the caller's token
   itself; the platform's legacy check would reject valid tokens):

   ```sh
   npx supabase functions deploy notify --project-ref YOUR-PROJECT-REF --no-verify-jwt
   ```

Each person then turns notifications on per device from **profile menu → Profil & notiser**.
On iPhone this only works once the app is **installed to the home screen** (iOS 16.4+).

### 6. Host it and install it

Host the folder on any static host over **HTTPS** (GitHub Pages works well; HTTPS is required
for the service worker, push, and geolocation). Then on each phone, open the site and use
**Add to Home Screen** to install it as an app.

## Everyday use

- The **bottom bar** switches between Kalender, Att göra, Sysslor, Idéer, and Matsedel, the same
  five for everyone. The **＋** button adds something to the current view.
- The **profile pill** (top-right) opens a menu with **Poäng** (your balance), **Belöningar**
  (the reward shop), **Budget** (parents only), **Profil & notiser** (colour + notifications),
  **Väderplats**, the **theme** switch, and **log out**.
- **Weather location:** tap the weather in the header, or profile menu → **Väderplats**, then
  search a town or use your current location. It's saved per device.

## Migrating from the standalone budget app

The budget here is a port of the standalone OneDrive budget app and uses the same data shape.
To bring an existing `budget.json` across, upsert it into the single-row `public.budget`
table's `data` column (keep the `months` / `currentMonth` / `deletedMonths` keys) via the SQL
editor. Keep any such export out of a public repo; it contains your real figures.

## Project structure

```
index.html            Page shell (header, views, bottom nav, FAB, dialogs)
manifest.json         PWA manifest ("Add to Home Screen")
sw.js                 Service worker (receives push notifications)
icons/                App icon

styles/               CSS, split by concern; design tokens for the dark + light themes
  base.css            Tokens, reset, typography
  layout.css          App shell, header, bottom nav, FAB, profile menu
  components.css      Cards, chips, avatars, lists, dialogs' contents
  budget.css          Budget view (scoped under .budget)
  matsedel.css        Veckans matsedel (menu-card layout)
  routines.css        Sysslor → Rutiner (streck board + tally marks)
  rewards.css         Belöningar (reward shop)
  overlays.css        Toasts and dialogs
  responsive.css      Phone breakpoints

scripts/              Plain JS, loaded in order (classic scripts, not modules)
  config.js           Your Supabase URL + anon key + VAPID public key + weather default
  helpers.js          Formatting, dates, colours, categories
  supa.js             Supabase client + auth/session helpers
  toast.js            Toast + undo notifications
  state.js            In-memory data + realtime subscriptions
  auth.js             Login screen, role gating, app startup
  header.js           Date header + event counts
  weather.js          Weather widget + location picker (Open-Meteo)
  calendar.js         Kalender
  tasks.js            Sysslor → Jobb (chore board)
  routines.js         Sysslor → Rutiner (streck / behaviour rewards)
  rewards.js          Belöningar (reward shop: tiers, rewards, redemptions)
  credits.js          Poäng (balances, ledger, payouts)
  suggestions.js      Idéer (voting)
  todos.js            Att göra
  shopping.js         Inköp (shopping-needs board)
  chat.js             Comment threads + image attachments
  profile.js          Personal colour + push toggle
  budget.js           Budget (parents only), Supabase-backed
  matsedel.js         Veckans matsedel (plan, dish library, wishes)
  theme.js            Light/dark switch
  push.js             Notification permission + subscription
  main.js             View routing, FAB, profile menu, wiring

sql/
  schema.sql          Base tables, RLS policies, workflow functions
  migrations/         Additive, idempotent schema updates (run after schema.sql)

supabase/
  functions/notify/   Edge Function that sends web-push notifications
  config.toml         Function config (notify runs with verify_jwt off)
```

## Privacy & security

Your family's data lives in your own Supabase project. What keeps it safe isn't secrecy of
the front end (the anon key ships in the browser by design); it's:

- **Row Level Security on every table, default-deny**, so nothing is readable without being
  signed in, and each person only sees their own slice (kids never see the budget or other
  kids' private items).
- **Privileged actions behind `SECURITY DEFINER` functions**, so credits can only change
  through the approve/adjust/payout flow, and a kid can't credit themselves.
- **Public sign-ups disabled**, so only parent-created accounts exist.
- **Real secrets stay server-side**: the `service_role` key and the VAPID *private* key live
  only as Supabase secrets, never in this repo.

## Credits

Created by Deansie. Co-authored with Claude (Anthropic).
