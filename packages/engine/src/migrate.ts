// Runs the numbered schema changes once each, in order, recording them in schema_migrations.
import type { Db } from "./db";
import m001 from "./migrations/001_init";
import m002 from "./migrations/002_isolation";
import m003 from "./migrations/003_sync";
import m004 from "./migrations/004_journal";
import m005 from "./migrations/005_auth";
import m006 from "./migrations/006_one_night";
import m007 from "./migrations/007_detect_dismissed";

export const MIGRATIONS: [string, string][] = [
  ["001_init", m001],
  ["002_isolation", m002],
  ["003_sync", m003],
  ["004_journal", m004],
  ["005_auth", m005],
  ["006_one_night", m006],
  ["007_detect_dismissed", m007],
];

export async function migrate(db: Db): Promise<string[]> {
  await db.admin.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await db.admin.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const ran: string[] = [];
  for (const [name, sql] of MIGRATIONS) {
    if (done.has(name)) continue;
    await db.tx(async (q) => {
      await q.exec(sql);
      await q.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
    });
    ran.push(name);
  }
  return ran;
}
