// Accounts and sign-in (PLAN.md §4.1-4.2). The server never sees a password: the device derives authKey from it
// (Argon2id + HKDF, @somnium/shared) and that is what is checked here, stored as a scrypt hash like a password
// would be. Sessions are random tokens (only their SHA-256 is stored): an HttpOnly cookie for the browser, a
// bearer token for the apps. Two-factor sign-in is TOTP (RFC 6238) with eight one-time backup codes, ported from
// Money Manager (server/src/auth.js); the TOTP secret is encrypted with the server's own key (DATA_DIR/app.key).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Db } from "@somnium/engine";
import { uuidv7 } from "@somnium/engine";
import { RECOVERY_KEY_CHARS } from "@somnium/shared";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt of a secret the server must check later: the authKey, a backup code, a reset code. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(secret, salt, 32, PARAMS);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function checkSecret(secret: string, stored: string | null): Promise<boolean> {
  if (!stored?.startsWith("scrypt$")) { await scrypt(secret, Buffer.alloc(16), 32, PARAMS); return false; } // same time either way
  const [, salt, key] = stored.split("$");
  const got = await scrypt(secret, Buffer.from(salt!, "base64"), 32, PARAMS);
  return crypto.timingSafeEqual(got, Buffer.from(key!, "base64"));
}
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export const COOKIE = "somnium_session";
export const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 60);
const DEVICE_LABEL_MAX = 80;

export interface SessionUser { id: string; username: string; role: "admin" | "user"; sessionId: string }

export async function createSession(db: Db, userId: string, device: string, platform: string, deviceId: string | null = null): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.admin.query(
    "INSERT INTO sessions (id, user_id, token_hash, device_name, platform, device_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval)",
    [uuidv7(), userId, sha(token), device.slice(0, DEVICE_LABEL_MAX), platform.slice(0, 20), deviceId, String(SESSION_DAYS)]);
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

/** Every sign-in from a device this account has not seen before leaves a note in the activity log (PLAN.md §4.2).
 *  "Seen" is by the install's own random id, because two laptops can share a label. The notes are what remembers
 *  it: sessions are deleted at sign-out. A client that sends no id is told apart by label. The address is never written. */
export async function noteNewDevice(db: Db, userId: string, device: string, deviceId: string | null): Promise<void> {
  const text = `Signed in on ${device.trim().slice(0, DEVICE_LABEL_MAX)}`;
  const seen = deviceId
    ? await db.admin.query("SELECT 1 FROM account_events WHERE user_id = $1 AND device_id = $2 LIMIT 1", [userId, deviceId])
    : await db.admin.query("SELECT 1 FROM account_events WHERE user_id = $1 AND device_id IS NULL AND text = $2 LIMIT 1", [userId, text]);
  if (seen.rows.length) return;
  await db.admin.query("INSERT INTO account_events (id, user_id, text, device_id) VALUES ($1,$2,$3,$4)", [uuidv7(), userId, text, deviceId]);
}
/** A note in the account's own activity log about a change to its sign-in (never a secret, never an address). */
export async function noteAccount(db: Db, userId: string, text: string): Promise<void> {
  await db.admin.query("INSERT INTO account_events (id, user_id, text) VALUES ($1,$2,$3)", [uuidv7(), userId, text]);
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
const FAIL_WINDOW = 15 * 60000;
const fails = new Map<string, number[]>();
// A sign-in may send any username of any length, so a key is cut to size and every key is swept on every call, not
// just the ones asked about: names tried once and never again must not stay in memory for good.
const failKey = (k: string) => k.slice(0, 64);
function pruneFails() {
  const cutoff = Date.now() - FAIL_WINDOW;
  for (const [k, times] of fails) {
    const recent = times.filter((t) => t > cutoff);
    if (recent.length) fails.set(k, recent); else fails.delete(k);
  }
}
export function tooManyTries(keys: string[]): boolean {
  pruneFails();
  return keys.some((k) => (fails.get(failKey(k))?.length ?? 0) >= 5);
}
export function recordFail(keys: string[]) {
  pruneFails();
  for (const k of keys.map(failKey)) fails.set(k, [...(fails.get(k) ?? []), Date.now()]);
}
/** Tests only: forget the failed tries, so one wait does not spill into the next test. */
export const forgetFails = () => fails.clear();
/** Tests only: how many keys are being remembered. */
export const failKeyCount = () => fails.size;

export const validUsername = (u: unknown): u is string => typeof u === "string" && /^[a-zA-Z0-9._-]{2,40}$/.test(u);
/** The authKey is 32 bytes as base64url (43 characters); the password rules themselves are checked on the device. */
export const validAuthKey = (k: unknown): k is string => typeof k === "string" && /^[A-Za-z0-9_-]{43}$/.test(k);
/** A salt is 16 bytes as base64url; a wrapped key is a sealed envelope ("v1.<iv>.<bytes>"), checked loosely: the
 *  server never opens it, the device finds out if it is wrong. */
export const validSalt = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{22}$/.test(s);
export const validWrapped = (w: unknown): w is string => typeof w === "string" && /^v1\.[A-Za-z0-9_-]{10,40}\.[A-Za-z0-9_-]{40,200}$/.test(w);
/** The install's own random id: long enough not to collide, short and plain enough to store and compare. */
export const validDeviceId = (d: unknown): d is string => typeof d === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(d);
export const newInviteCode = () => crypto.randomBytes(9).toString("base64url");

// ---------- the server's own key: DATA_DIR/app.key (made on first start, mode 600) or APP_KEY (base64, 32 bytes) ----------
// It encrypts TOTP secrets at rest and makes the stand-in salts below. It is not the journal's key (the server has none).
/** The server's key cannot open what it encrypted, or is unusable. Said plainly: the message is all a person needs, and a stack trace adds nothing. */
export class ServerKeyError extends Error { constructor(message = "Server key missing or changed") { super(message); } }
let serverKey: Buffer | undefined;
/** The key in DATA_DIR/app.key, made on first start. "wx" fails if the file exists, so two starts at once cannot overwrite each other's key. */
export function keyFromFile(dataDir: string): Buffer {
  const f = path.join(dataDir, "app.key");
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(f, crypto.randomBytes(32).toString("base64"), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    if (fs.statSync(f).mode & 0o044) console.warn(`${f} can be read by other users on this machine. Run: chmod 600 ${f}`);
  }
  const key = Buffer.from(fs.readFileSync(f, "utf8").trim(), "base64");
  if (key.length !== 32) throw new ServerKeyError(`${f} is not a valid key file`);
  return key;
}
export function loadServerKey(dataDir: string): Buffer {
  if (serverKey) return serverKey;
  if (process.env.APP_KEY) {
    serverKey = Buffer.from(process.env.APP_KEY, "base64");
    if (serverKey.length !== 32) { serverKey = undefined; throw new ServerKeyError("APP_KEY must be 32 bytes, base64 encoded"); }
    return serverKey;
  }
  return (serverKey = keyFromFile(dataDir));
}
export function encryptForServer(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}
export function decryptForServer(blob: string, key: Buffer): string {
  // the tag check fails when APP_KEY or app.key is not the one this was encrypted with
  try {
    const [v, iv, tag, ct] = String(blob).split(":");
    if (v !== "v1") throw new Error("unknown ciphertext version");
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv!, "base64"));
    d.setAuthTag(Buffer.from(tag!, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct!, "base64")), d.final()]).toString("utf8");
  } catch { throw new ServerKeyError(); }
}
/** The salt GET /auth/salt answers for a username that does not exist: the same every time for that name, and
 *  not tellable from a real one, so the endpoint cannot be used to list who has an account. */
export const standInSalt = (username: string, key: Buffer): string =>
  crypto.createHmac("sha256", key).update("stand-in-salt:" + username).digest().subarray(0, 16).toString("base64url");

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const b32encode = (buf: Buffer): string => { let bits = "", out = ""; for (const b of buf) bits += b.toString(2).padStart(8, "0"); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)]; return out; };
export const b32decode = (s: string): Buffer => { let bits = ""; for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, "0"); const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
export function totp(secretB32: string, t = Date.now(), step = 30, digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / step)));
  const h = crypto.createHmac("sha1", b32decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** digits).padStart(digits, "0");
}
/** The code now, or the one just before or after (a clock a little off, a code typed late). Answers the step it
 *  belongs to, or null. */
export function totpOk(secretB32: string, code: unknown, t = Date.now()): number | null {
  const c = String(code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  for (const d of [-1, 0, 1]) {
    const at = t + d * 30000;
    if (crypto.timingSafeEqual(Buffer.from(totp(secretB32, at)), Buffer.from(c))) return Math.floor(at / 1000 / 30);
  }
  return null;
}
/** Uses up an authenticator code: a code seen over someone's shoulder must not work a second time, so only a step
 *  later than the last one accepted counts. One statement, so two requests at once cannot both win. */
export async function useTotp(db: Db, userId: string, secretB32: string, code: unknown): Promise<boolean> {
  const step = totpOk(secretB32, code);
  if (step === null) return false;
  const u = await db.admin.query("UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2) RETURNING id", [userId, step]);
  return u.rows.length > 0;
}
export const newTotpSecret = () => b32encode(crypto.randomBytes(20));
export const otpauthUrl = (username: string, secret: string) => `otpauth://totp/Somnium:${encodeURIComponent(username)}?secret=${secret}&issuer=Somnium&digits=6&period=30`;

// ---------- backup codes and reset codes: 10 characters from the recovery key's alphabet, shown once, kept hashed ----------
export const BACKUP_CODES = 8;
export const CODE_LENGTH = 10;
export function newCode(): string {
  let s = "";
  while (s.length < CODE_LENGTH) for (const b of crypto.randomBytes(CODE_LENGTH)) if (b < 248 && s.length < CODE_LENGTH) s += RECOVERY_KEY_CHARS[b % RECOVERY_KEY_CHARS.length]; // 248 = 8 × 31: no bias
  return s;
}
/** What was typed, without spaces, dashes or case. */
export const plainCode = (typed: unknown): string => String(typed ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatCode = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`;

/** Eight fresh backup codes for the account, replacing any older ones. Returns the codes to show once. */
export async function issueBackupCodes(db: Db, userId: string): Promise<string[]> {
  const codes = Array.from({ length: BACKUP_CODES }, newCode);
  await db.admin.query("DELETE FROM backup_codes WHERE user_id = $1", [userId]);
  for (const c of codes) await db.admin.query("INSERT INTO backup_codes (id, user_id, code_hash) VALUES ($1,$2,$3)", [uuidv7(), userId, await hashSecret(c)]);
  return codes.map(formatCode);
}
/** Uses up a backup code: true when it was one of the unused ones (it is marked used in the same breath). */
export async function useBackupCode(db: Db, userId: string, typed: unknown): Promise<boolean> {
  const code = plainCode(typed);
  if (code.length !== CODE_LENGTH) return false;
  const { rows } = await db.admin.query("SELECT id, code_hash FROM backup_codes WHERE user_id = $1 AND used_at IS NULL", [userId]);
  for (const r of rows) {
    if (await checkSecret(code, r.code_hash)) {
      const u = await db.admin.query("UPDATE backup_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id", [r.id]);
      return u.rows.length > 0;
    }
  }
  return false;
}

/** A one-time reset code for an account whose password is lost (PLAN.md §4.4, admin only): valid for a day. The
 *  journal stays sealed: the code only lets the person set a new password (new authKey, no wrapped data key). */
export const RESET_MESSAGE = "Your password is set. Your journal stays sealed until you enter your recovery key or open the app on a device that is still signed in.";
export async function issueResetCode(db: Db, userId: string): Promise<string> {
  const code = newCode();
  await db.admin.query("UPDATE users SET reset_code_hash = $2, reset_expires_at = now() + interval '1 day' WHERE id = $1", [userId, await hashSecret(code)]);
  return formatCode(code);
}
