// Admin commands on the server itself, for when nobody can get into the admin panel (PLAN.md §4.4):
//   node --import tsx apps/server/src/cli.ts reset-password <username>   prints a one-time reset code (valid a day)
//   node --import tsx apps/server/src/cli.ts disable-2fa <username>      turns two-factor sign-in off for them
// Uses the same DATABASE_URL / DATA_DIR as the server. A reset code only lets the person set a new password: the
// journal stays sealed until their recovery key re-wraps the data key (no device can: the reset signs them out, which forgets their keys, LDJ-10).
import path from "node:path";
import { issueResetCode, noteAccount } from "./auth";

const [cmd, username] = process.argv.slice(2);
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
const db = process.env.DATABASE_URL
  ? (await import("@somnium/engine/pg")).pgDb(process.env.DATABASE_URL)
  : await (await import("@somnium/engine/pglite")).pgliteDb(path.join(DATA_DIR, "db"));

try {
  const u = username ? (await db.admin.query("SELECT id FROM users WHERE username = $1", [username.toLowerCase()])).rows[0] : null;
  if (cmd === "reset-password" && u) {
    const code = await issueResetCode(db, u.id);
    await db.admin.query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
    await noteAccount(db, u.id, "An admin made a password reset code");
    console.log(`Reset code for ${username}: ${code}\nValid for one day. On the sign-in screen they choose "Forgot password?", then "I have a reset code", and set a new password.\nTheir journal stays sealed until they enter their recovery key.`);
  } else if (cmd === "disable-2fa" && u) {
    await db.admin.query("UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL WHERE id = $1", [u.id]);
    await db.admin.query("DELETE FROM backup_codes WHERE user_id = $1", [u.id]);
    await noteAccount(db, u.id, "An admin turned two-factor sign-in off");
    console.log(`Two-factor sign-in is off for ${username}. They can turn it on again in Settings → Security.`);
  } else if (username && !u) {
    console.error(`No account named ${username}`); process.exitCode = 1;
  } else {
    console.error("Usage: cli.ts reset-password <username> | disable-2fa <username>"); process.exitCode = 1;
  }
} finally { await db.close(); }
