// The tables that are a person's data and travel between devices, parents before children (the order rows are written in).
// Not synced: sign-in tables, the events feed. New user tables are added here and get their sync trigger in the
// migration that creates them (syncTriggers below; 003_sync has the trigger function).
// Rows are never removed by the app (deleted_at marks them gone), so a deletion is just another upsert everywhere.
export const SYNCED: { name: string; pk: string[] }[] = [
  { name: "user_settings", pk: ["user_id"] },
  { name: "nights", pk: ["id"] },
  { name: "dreams", pk: ["id"] },
  { name: "elements", pk: ["id"] },
  { name: "dream_elements", pk: ["id"] },
  { name: "media", pk: ["id"] },
  { name: "reality_checks", pk: ["id"] },
  { name: "practice_log", pk: ["id"] },
  { name: "course_progress", pk: ["id"] },
  { name: "goals", pk: ["id"] },
  { name: "reminders", pk: ["id"] },
];
export const SYNCED_BY_NAME = new Map(SYNCED.map((t, i) => [t.name, { ...t, order: i }]));

/** The sync_log trigger for the named tables: a migration creates it right after the table itself. */
export const syncTriggers = (names: string[]) => SYNCED.filter((t) => names.includes(t.name))
  .map((t) => `CREATE TRIGGER sync_log AFTER INSERT OR UPDATE OR DELETE ON ${t.name} FOR EACH ROW EXECUTE FUNCTION somnium_log_change(${t.pk.map((c) => `'${c}'`).join(", ")});`)
  .join("\n");
