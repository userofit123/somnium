// One live night per date (PLAN.md §5), for installs that ran 004 before it had the rule: 004 was changed after it
// had already run on some databases, so their nights table lacks nights_user_date_live. Nights a person already has
// twice for one date are settled first: every dream goes to the newest of them (the one most recently made), and the
// others are soft-deleted (so the change syncs to every device; nothing is erased). Naps stay out of the rule.
// Running it where the index exists changes nothing: then there can't be two live nights for one date.
export default /* sql */ `
WITH ranked AS (
  SELECT id, user_id, date,
    first_value(id) OVER (PARTITION BY user_id, date ORDER BY created_at DESC, id DESC) AS keep
  FROM nights WHERE deleted_at IS NULL AND NOT nap
), extra AS (SELECT id, keep FROM ranked WHERE id <> keep)
UPDATE dreams d SET night_id = extra.keep, updated_at = now()
FROM extra WHERE d.night_id = extra.id;

WITH ranked AS (
  SELECT id,
    first_value(id) OVER (PARTITION BY user_id, date ORDER BY created_at DESC, id DESC) AS keep
  FROM nights WHERE deleted_at IS NULL AND NOT nap
)
UPDATE nights n SET deleted_at = now(), updated_at = now()
FROM ranked WHERE n.id = ranked.id AND ranked.id <> ranked.keep;

CREATE UNIQUE INDEX IF NOT EXISTS nights_user_date_live ON nights (user_id, date) WHERE deleted_at IS NULL AND NOT nap;
`;
