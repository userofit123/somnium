// Accounts and sign-in: scrypt password hashes, random session tokens (only their SHA-256 is stored),
// an HttpOnly cookie for the browser and a bearer token for the apps, invites, and the admin's user list.
import crypto from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "@somnium/engine";
import { uuidv7 } from "@somnium/engine";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 32, PARAMS);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function checkPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored?.startsWith("scrypt$")) { await scrypt(pw, Buffer.alloc(16), 32, PARAMS); return false; } // same time either way
  const [, salt, key] = stored.split("$");
  const got = await scrypt(pw, Buffer.from(salt!, "base64"), 32, PARAMS);
  return crypto.timingSafeEqual(got, Buffer.from(key!, "base64"));
}
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export const COOKIE = "somnium_session";
export const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 60);

export interface SessionUser { id: string; username: string; role: "admin" | "user"; sessionId: string }

export async function createSession(db: Db, userId: string, device: string, platform: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.admin.query(
    "INSERT INTO sessions (id, user_id, token_hash, device_name, platform, expires_at) VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval)",
    [uuidv7(), userId, sha(token), device.slice(0, 80), platform.slice(0, 20), String(SESSION_DAYS)]);
  return token;
}

// The name a signed-in device gets in Account → Signed-in devices, so you can tell your places apart:
// "Firefox on Linux", "Somnium app on Android". A name the app chose itself (anything but the generic ones) is kept.
const GENERIC = new Set(["", "browser", "android browser", "android app"]);
export function deviceLabel(given: unknown, ua: string | undefined): string {
  const g = (typeof given === "string" ? given : "").trim();
  if (!GENERIC.has(g.toLowerCase()) || !ua) return g || "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iPhone or iPad" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const app = g.toLowerCase() === "android app" || /Electron\//.test(ua) ? "Somnium app" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : g || "Browser";
  return os ? `${app} on ${os}` : app;
}

const seen = new Map<string, number>(); // session id → last time last_seen_at was written
export async function userForToken(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const r = (await db.admin.query(
    `SELECT s.id AS sid, u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL`, [sha(token)])).rows[0];
  if (!r) return null;
  // sliding expiry, written at most every 10 minutes
  if ((seen.get(r.sid) ?? 0) < Date.now() - 600000) {
    seen.set(r.sid, Date.now());
    await db.admin.query("UPDATE sessions SET last_seen_at = now(), expires_at = greatest(expires_at, now() + ($2 || ' days')::interval) WHERE id = $1", [r.sid, String(SESSION_DAYS)]);
  }
  return { id: r.id, username: r.username, role: r.role, sessionId: r.sid };
}

// failed sign-ins: after 5 in 15 minutes from one address (or for one name), wait
const fails = new Map<string, number[]>();
export function tooManyTries(keys: string[]): boolean {
  const now = Date.now();
  return keys.some((k) => (fails.get(k) ?? []).filter((t) => t > now - 15 * 60000).length >= 5);
}
export function recordFail(keys: string[]) {
  const now = Date.now();
  for (const k of keys) fails.set(k, [...(fails.get(k) ?? []).filter((t) => t > now - 15 * 60000), now]);
}

export const validUsername = (u: unknown): u is string => typeof u === "string" && /^[a-zA-Z0-9._-]{2,40}$/.test(u);
export const validPassword = (p: unknown): p is string => typeof p === "string" && p.length >= 8 && p.length <= 200;
export const newInviteCode = () => crypto.randomBytes(9).toString("base64url");
