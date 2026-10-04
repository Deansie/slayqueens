-- ======================================== INKÖP: ORDNING 2026-10-04
-- Parents can put the Inköp lists in the order they like ("↕ Ändra ordning", then ↑/↓ per list);
-- everyone sees that order (a kid just sees fewer lists). A plain sort number per category.
-- Existing lists keep their current oldest-first order. Writes are covered by the existing
-- "parents manage shopping topics" policy, so no RLS change is needed.
-- Idempotent: safe to run (or re-run) on the live database.

alter table public.shopping_topics add column if not exists sort integer;

-- Number any list that has no place yet after the ones that do, oldest first.
with ranked as (
  select id, row_number() over (order by created_at, id) - 1 as rn
  from public.shopping_topics
  where sort is null
)
update public.shopping_topics t
set sort = r.rn + coalesce((select max(sort) + 1 from public.shopping_topics where sort is not null), 0)
from ranked r
where t.id = r.id;
