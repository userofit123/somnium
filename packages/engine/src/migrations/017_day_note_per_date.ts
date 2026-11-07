// LDJ-41 review: one live day note per date, as nights have (nights_user_date_live). Two devices can each write a note for
// the same date while offline: the sync settles them (sync/core.ts NATURAL_KEYS and settleDayNote), the newest staying
// live and the other removed with merged_into pointing at it, so a device holding the key can join its text into the
// one that stayed (a sealed value is bound to its row's id, so the text is never moved to the other row as it is).
// Duplicates already here are settled the same way first: the newest per date stays (updated_at, then id).
export default /* sql */ `
ALTER TABLE day_notes ADD COLUMN IF NOT EXISTS merged_into uuid;
WITH ranked AS (
  SELECT id, user_id, date, updated_at,
    first_value(id) OVER (PARTITION BY user_id, date ORDER BY updated_at DESC, id DESC) AS keep
  FROM day_notes WHERE deleted_at IS NULL
)
UPDATE day_notes d SET deleted_at = now(), merged_into = r.keep FROM ranked r WHERE d.id = r.id AND r.id <> r.keep;
CREATE UNIQUE INDEX IF NOT EXISTS day_notes_user_date_live ON day_notes (user_id, date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS day_notes_merged ON day_notes (id) WHERE deleted_at IS NOT NULL AND merged_into IS NOT NULL;
`;
