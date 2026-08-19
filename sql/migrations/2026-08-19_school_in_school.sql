-- ============================================= SKOLA · IN_SCHOOL FLAG 2026-08-19
-- "Which kids go to school" is now a per-profile flag instead of a hardcoded name list in the
-- front end. school.js `kids()` reads profiles.in_school; a parent flags a child once (by SQL,
-- the same way names are set). Idempotent: safe to run (or re-run) on the live database.

alter table public.profiles add column if not exists in_school boolean not null default false;

-- Preserve the previous behaviour: the four kids the front end used to hardcode become in_school.
-- Adjust this set (or flip the flag per child) whenever the household's school-going kids change.
update public.profiles set in_school = true
  where role = 'kid' and lower(trim(name)) in ('abbe', 'julia', 'olle', 'alfred');
