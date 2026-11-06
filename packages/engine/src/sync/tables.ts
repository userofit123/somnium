// The tables that are a person's data and travel between devices, parents before children (the order rows are written in).
// Not synced: sign-in tables, uploaded files (fetched on demand), the events feed. New user tables are added here
// and get their sync trigger in a migration (see 003_sync for the trigger's shape).
export const SYNCED: { name: string; pk: string[] }[] = [
  { name: "user_settings", pk: ["user_id"] },
];
export const SYNCED_BY_NAME = new Map(SYNCED.map((t, i) => [t.name, { ...t, order: i }]));
