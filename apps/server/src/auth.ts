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

// Wrong sign-in tries (PLAN.md §4.2, LDJ-59), kept in the database (sign_in_tries) so a restart does not forget them.
// Counts over the last 15 minutes:
// - per address ("ip:"): five wrong tries, then a hard wait until the oldest is 15 minutes old. Always applies.
// - per name ("u:"): five free tries, then a growing wait after the latest one (1 s, 2 s, 4 s ... at most 30 s). A
//   refused try is not stored, so a stranger with many addresses can take each opening the moment it comes and keep
//   the name almost always waiting. That is why the name wait only holds up a device the account has never signed in
//   from (knownDevice below): the owner's own browser or app goes straight to its per-address limit, and a stranger,
//   who cannot show such a device, is slowed down.
// - per session ("s:"): for the checks that need a signed-in session (asking for the password again, the device's key
//   proof). Five wrong tries, then a hard wait like an address. The name wait never applies there: a session is already
//   one account on one device, and counting it by name would let a stranger's guesses at the sign-in screen lock the
//   owner out of their own settings.
const WINDOW = "15 minutes", WINDOW_S = 15 * 60;
const ADDRESS_TRIES = 5, SESSION_TRIES = 5, NAME_FREE = 5, NAME_MAX_WAIT = 30;
// A sign-in may send any username of any length, so a key is cut to size before it is stored.
const cut = (k: string) => k.slice(0, 64);
/** Seconds a name waits after its latest try, with n tries in the window (the one about to be made not counted). */
export const nameWait = (n: number) => (n < NAME_FREE ? 0 : Math.min(NAME_MAX_WAIT, 2 ** (n - NAME_FREE)));
export type Try = { release: () => Promise<void> } | { wait: number; error: string };
const prune = (db: Db) => db.admin.query(`DELETE FROM sign_in_tries WHERE at < clock_timestamp() - interval '${WINDOW}'`);
/** The second count next to the address: a name (waits unless the device is known) or a session (a hard limit). */
type Scope = { name: string; known?: boolean } | { session: string };
const secondKey = (s: Scope) => cut("session" in s ? `s:${s.session}` : `u:${s.name}`);
const plural = (s: number) => `${s} second${s === 1 ? "" : "s"}`;

/**
 * Counts this try before the slow hash, so a burst sent at once can't all pass the check and only then be recorded:
 * the check and the reservation are one transaction, holding a lock per key, so each of the burst sees the ones
 * before it. Answers how long to wait when there have been too many, otherwise `release` to take the try back:
 * call it when the secret was right. Not calling it leaves the try counted as a failure.
 * `known`: the device has signed in to this name before, so the name wait does not apply (the address limit does).
 */
export async function reserveTry(db: Db, ip: string, name: string, o: { known?: boolean } = {}): Promise<Try> {
  return reserve(db, ip, { name, known: o.known });
}
/** The same for a check that needs a session: counted per session and per address, never per name. */
export async function reserveSessionTry(db: Db, ip: string, sessionId: string): Promise<Try> {
  return reserve(db, ip, { session: sessionId });
}
async function reserve(db: Db, ip: string, scope: Scope): Promise<Try> {
  const a = cut(`ip:${ip}`), u = secondKey(scope);
  await prune(db);
  const got = await db.tx(async (q): Promise<{ wait: number; error: string } | { ids: unknown[] }> => {
    for (const k of [a, u].sort()) await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [k]);
    const r = (await q.query(
      `SELECT count(*) FILTER (WHERE key = $1)::int AS ip_n,
              extract(epoch FROM clock_timestamp() - min(at) FILTER (WHERE key = $1))::float AS ip_age,
              count(*) FILTER (WHERE key = $2)::int AS n,
              extract(epoch FROM clock_timestamp() - min(at) FILTER (WHERE key = $2))::float AS age,
              extract(epoch FROM clock_timestamp() - max(at) FILTER (WHERE key = $2))::float AS since
       FROM sign_in_tries WHERE key IN ($1, $2) AND at > clock_timestamp() - interval '${WINDOW}'`, [a, u])).rows[0] as any;
    if (r.ip_n >= ADDRESS_TRIES) return { wait: Math.max(1, Math.ceil(WINDOW_S - r.ip_age)), error: "Too many tries. Wait 15 minutes." };
    if ("session" in scope) {
      if (r.n >= SESSION_TRIES) return { wait: Math.max(1, Math.ceil(WINDOW_S - r.age)), error: "Too many tries. Wait 15 minutes." };
    } else if (!scope.known) {
      const left = nameWait(r.n) - (r.since ?? Infinity);
      if (left > 0) { const s = Math.ceil(left); return { wait: s, error: `Too many tries for this name. Wait ${plural(s)}.` }; }
    }
    return { ids: (await q.query("INSERT INTO sign_in_tries (key) VALUES ($1), ($2) RETURNING id", [a, u])).rows.map((x: any) => x.id) };
  });
  if ("wait" in got) return got;
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      await db.admin.query("DELETE FROM sign_in_tries WHERE id = ANY($1)", [got.ids]);
    },
  };
}
/** A wrong answer that was not reserved first (a second factor checked after the password): counted the same way. */
export async function recordFail(db: Db, ip: string, name: string): Promise<void> {
  await db.admin.query("INSERT INTO sign_in_tries (key) VALUES ($1), ($2)", [cut(`ip:${ip}`), secondKey({ name })]);
}
/** The same for a wrong answer inside a session (a wrong code at /2fa/disable). */
export async function recordSessionFail(db: Db, ip: string, sessionId: string): Promise<void> {
  await db.admin.query("INSERT INTO sign_in_tries (key) VALUES ($1), ($2)", [cut(`ip:${ip}`), secondKey({ session: sessionId })]);
}

// ---------- known devices: what lets the owner past the name wait ----------
// Two ways to show it, neither of which a stranger has:
// - the install's own random id (deviceId), sent at every sign-in by the web app and the apps, which the account's
//   activity log remembers from the first sign-in on it (account_events.device_id, never shown to anyone) or a live
//   session still carries;
// - a long-lived cookie the server signs at every successful sign-in (DEVICE_COOKIE), for the doors that do not send a
//   deviceId (the recovery key, a reset code). Each mark is a random nonce and an HMAC of it with the account's id
//   under the server's key, so it names one account, cannot be made without the key, and holds nothing personal.
//   A browser keeps marks for a few accounts at most.
export const DEVICE_COOKIE = "somnium_device";
export const DEVICE_COOKIE_DAYS = 400; // the longest a browser keeps a cookie
const MARKS_MAX = 5;
const markMac = (nonce: string, userId: string, key: Buffer) =>
  crypto.createHmac("sha256", key).update(`known-device|${nonce}|${userId}`).digest("base64url").slice(0, 32);
const marksOf = (cookie: string | undefined) =>
  (cookie ?? "").slice(0, 600).split("~").filter((m) => /^[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{32}$/.test(m));
export function hasDeviceMark(cookie: string | undefined, userId: string, key: Buffer): boolean {
  return marksOf(cookie).some((m) => {
    const [nonce, mac] = m.split(".") as [string, string];
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(markMac(nonce, userId, key)));
  });
}
/** The cookie with a mark for this account added (or kept, if it has one), the newest first. */
export function addDeviceMark(cookie: string | undefined, userId: string, key: Buffer): string {
  const marks = marksOf(cookie);
  if (hasDeviceMark(cookie, userId, key)) return marks.join("~");
  const nonce = crypto.randomBytes(12).toString("base64url");
  return [`${nonce}.${markMac(nonce, userId, key)}`, ...marks].slice(0, MARKS_MAX).join("~");
}
/** Has this device signed in to the account with this name before? False for a name without an account. */
export async function knownDevice(db: Db, name: string, deviceId: string | null, cookie: string | undefined, key: Buffer): Promise<boolean> {
  if (!deviceId && !cookie) return false;
  const u = (await db.admin.query("SELECT id FROM users WHERE username = $1", [name])).rows[0];
  if (!u) return false;
  if (cookie && hasDeviceMark(cookie, u.id, key)) return true;
  if (!deviceId) return false;
  const r = await db.admin.query(
    `SELECT 1 FROM account_events WHERE user_id = $1 AND device_id = $2
     UNION ALL SELECT 1 FROM sessions WHERE user_id = $1 AND device_id = $2 LIMIT 1`, [u.id, deviceId]);
  return r.rows.length > 0;
}
/** Tests only: forget the failed tries, so one wait does not spill into the next test. */
export const forgetFails = async (db: Db) => { await db.admin.query("DELETE FROM sign_in_tries"); };
/** Tests only: how many keys are being remembered. */
export const failKeyCount = async (db: Db) => Number((await db.admin.query("SELECT count(DISTINCT key)::int AS n FROM sign_in_tries")).rows[0].n);

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
/** Makes DATA_DIR private when it is new. The mode only applies to what is created: an existing folder (a mounted volume, say) keeps the mode it was given. */
export const makeDataDir = (dataDir: string) => { fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 }); };
/** Writes the key to a temp file first and links it into place: a crash leaves no key file or a whole one, never an empty one. Linking fails if the name exists, so two starts at once cannot overwrite each other's key. */
function writeKeyFile(f: string) {
  const tmp = `${f}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    const fd = fs.openSync(tmp, "wx", 0o600);
    try { fs.writeSync(fd, crypto.randomBytes(32).toString("base64")); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.linkSync(tmp, f);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    return false;
  } finally { fs.rmSync(tmp, { force: true }); }
  return true;
}
/** The key in DATA_DIR/app.key, made on first start. */
export function keyFromFile(dataDir: string): Buffer {
  const f = path.join(dataDir, "app.key");
  makeDataDir(dataDir);
  const made = !fs.existsSync(f) && writeKeyFile(f);
  if (!made && fs.statSync(f).mode & 0o044) console.warn(`${f} can be read by other users on this machine. Run: chmod 600 ${f}`);
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

/** The recovery salt GET /auth/recovery/salt answers for a name with no account, or an account with no recovery key:
 *  its own label, so it never equals the stand-in sign-in salt (that would tell real names from made-up ones). */
export const standInRecoverySalt = (username: string, key: Buffer): string =>
  crypto.createHmac("sha256", key).update("stand-in-recovery-salt:" + username).digest().subarray(0, 16).toString("base64url");

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
// It promises only the recovery key: a reset signs out every device, and signing out forgets the key a device held
// (LDJ-10, by design: a device signed out after a loss must not keep a way in), so no device can re-wrap after a reset.
// Device keys are the way back while still signed in (Settings → Security → Set a new password).
export const RESET_MESSAGE = "Your password is set. Your journal stays sealed until you enter your recovery key.";
export async function issueResetCode(db: Db, userId: string): Promise<string> {
  const code = newCode();
  await db.admin.query("UPDATE users SET reset_code_hash = $2, reset_expires_at = now() + interval '1 day' WHERE id = $1", [userId, await hashSecret(code)]);
  return formatCode(code);
}
