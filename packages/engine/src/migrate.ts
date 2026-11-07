// Runs the numbered schema changes once each, in order, recording them in schema_migrations.
import type { Db } from "./db";
import m001 from "./migrations/001_init";
import m002 from "./migrations/002_isolation";
import m003 from "./migrations/003_sync";
import m004 from "./migrations/004_journal";
import m005 from "./migrations/005_auth";
import m006 from "./migrations/006_one_night";
import m007 from "./migrations/007_detect_dismissed";
import m008 from "./migrations/008_night_merge";
import m009 from "./migrations/009_merge_record";
import m010 from "./migrations/010_plan_and_start";
import m011 from "./migrations/011_merge_pending";
import m012 from "./migrations/012_device_keys";
import m013 from "./migrations/013_sign_in_tries";

export const MIGRATIONS: [string, string][] = [
  ["001_init", m001],
  ["002_isolation", m002],
  ["003_sync", m003],
  ["004_journal", m004],
  ["005_auth", m005],
  ["006_one_night", m006],
  ["007_detect_dismissed", m007],
  ["008_night_merge", m008],
  ["009_merge_record", m009],
  ["010_plan_and_start", m010],
  ["011_merge_pending", m011],
  ["012_device_keys", m012],
  ["013_sign_in_tries", m013],
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
