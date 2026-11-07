// The harness talks to the database directly, never through a test-only route in the app: it makes the invites a new
// account needs, reads what the server really stores, and deletes the accounts it made. E2E_PSQL is the command that
// opens psql on the server's database; the default is the dev container.
import { execFileSync } from "node:child_process";

const PSQL = (process.env.E2E_PSQL ?? "docker exec -i somnium-db-1 psql -U somnium -d somnium").split(" ").filter(Boolean);

/** Runs SQL and returns the rows as arrays of text (unaligned, "|" separated, no header). */
export function sql(query: string): string[][] {
  const out = execFileSync(PSQL[0]!, [...PSQL.slice(1), "-v", "ON_ERROR_STOP=1", "-X", "-A", "-t", "-F", "\t"], { input: query, encoding: "utf8" });
  return out.split("\n").filter(Boolean).map((l) => l.split("\t"));
}
/** Letters and digits only, so a name is safe to put in SQL. */
const safe = (s: string) => s.replace(/[^a-z0-9-]/gi, "");

export function makeInvite(): string {
  const code = "e2e" + Math.random().toString(36).slice(2, 12);
  sql(`INSERT INTO invites (code, expires_at) VALUES ('${safe(code)}', now() + interval '1 hour')`);
  return code;
}
export const userId = (username: string) => sql(`SELECT id FROM users WHERE username = '${safe(username)}'`)[0]?.[0] ?? null;
/** Deletes the account; every user-owned table cascades from users. */
export function deleteUser(username: string) {
  sql(`DELETE FROM users WHERE username = '${safe(username)}'`);
}
/** Anything an earlier, crashed run left: the accounts and invites the harness makes all start with "e2e". */
export function sweep() {
  sql(`DELETE FROM users WHERE username LIKE 'e2e-%'; DELETE FROM invites WHERE code LIKE 'e2e%' AND used_by IS NULL`);
}
export const count = (table: string, uid: string) => Number(sql(`SELECT count(*) FROM ${safe(table)} WHERE user_id = '${safe(uid)}' AND deleted_at IS NULL`)[0]![0]);
