// The self-hosted server: sign-in and accounts, the engine behind /api, live updates over SSE,
// uploaded media, update checks, and (in production) the web app itself.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import fstatic from "@fastify/static";
import { createEngine, uuidv7, withUser, type Db, type Engine } from "@somnium/engine";
import { HttpError, isUuid, visible } from "@somnium/engine"; // the media handlers
import { isSealed } from "@somnium/shared";
import {
  hashSecret, checkSecret, createSession, deviceLabel, noteNewDevice, userForToken, reserveTry, recordFail, validUsername, validAuthKey, validSalt, validWrapped,
  newInviteCode, loadServerKey, encryptForServer, decryptForServer, standInSalt, totpOk, newTotpSecret, otpauthUrl, issueBackupCodes, useBackupCode, issueResetCode, plainCode,
  useTotp, noteAccount, validDeviceId, ServerKeyError, RESET_MESSAGE, COOKIE, SESSION_DAYS, type SessionUser,
} from "./auth";
import { VERSION, API_LEVEL, checkForUpdate } from "./version";

// mode "local": the desktop app's own server for a local account. Its data stays on the device as plaintext, so it
// doesn't insist on envelopes the way a real server does.
export interface Options { db: Db; dataDir: string; webDir?: string; logger?: boolean; host?: string; mode?: "server" | "local" }

/** A local (on-device) account: one person, signed in automatically by the desktop app. Returns a session token for them. */
export async function localSession(db: Db, name = "Me"): Promise<string> {
  let u = (await db.admin.query("SELECT id FROM users ORDER BY created_at LIMIT 1")).rows[0];
  if (!u) { u = { id: uuidv7() }; await db.admin.query("INSERT INTO users (id, username, display_name, role) VALUES ($1, 'me', $2, 'admin')", [u.id, name]); }
  return createSession(db, u.id, "This computer", "desktop");
}

declare module "fastify" { interface FastifyRequest { user: SessionUser | null } }

export async function buildApp(o: Options): Promise<{ app: FastifyInstance; engine: Engine }> {
  const engine = await createEngine(o.db, { mode: o.mode ?? "server" });
  const db = o.db;
  const app = Fastify({ logger: o.logger ?? false, bodyLimit: 30 * 1024 * 1024, trustProxy: true });
  await app.register(cookie);
  app.decorateRequest("user", null);
  for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif", "video/mp4", "application/octet-stream"])
    app.addContentTypeParser(t, { parseAs: "buffer", bodyLimit: 30 * 1024 * 1024 }, (_r, body, done) => done(null, body));
  app.addContentTypeParser(/^audio\//, { parseAs: "buffer", bodyLimit: 30 * 1024 * 1024 }, (_r, body, done) => done(null, body));

  const meta = async (k: string, fallback: unknown) => (await db.admin.query("SELECT value FROM app_meta WHERE key = $1", [k])).rows[0]?.value ?? fallback;
  const setMeta = (k: string, v: unknown) => db.admin.query("INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [k, JSON.stringify(v)]);

  // who is asking: the session cookie (browser) or "Authorization: Bearer <token>" (apps)
  app.addHook("onRequest", async (req) => {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    req.user = await userForToken(db, bearer ?? req.cookies[COOKIE]);
  });
  // cookie sign-ins must send the X-Somnium header on changes: other sites cannot add it, so they cannot act for you
  app.addHook("preHandler", async (req, reply) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.cookies[COOKIE] && !req.headers.authorization && req.headers["x-somnium"] !== "1" && req.url.startsWith("/api/"))
      return reply.code(403).send({ error: "Missing X-Somnium header" });
  });
  // a browser must take every answer as the type it says it is: an uploaded file can never be run as a page or script
  app.addHook("onSend", async (_req, reply) => { reply.header("x-content-type-options", "nosniff"); });
  const need = (req: FastifyRequest, reply: FastifyReply) => { if (!req.user) { reply.code(401).send({ error: "Sign in first" }); return false; } return true; };
  const needAdmin = (req: FastifyRequest, reply: FastifyReply) => { if (!need(req, reply)) return false; if (req.user!.role !== "admin") { reply.code(403).send({ error: "Admins only" }); return false; } return true; };
  const setCookie = (req: FastifyRequest, reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: req.protocol === "https", path: "/", maxAge: SESSION_DAYS * 86400 });

  // ----- sign-in (PLAN.md §4.1-4.2): the device sends authKey, never the password -----
  const serverKey = loadServerKey(o.dataDir);
  const publicUser = (u: SessionUser) => ({ id: u.id, username: u.username, role: u.role });
  const badName = "Use 2-40 letters, numbers, dots, dashes or underscores for the username";
  const badBundle = "The sign-in keys do not look right. Update the app and try again.";
  app.get("/api/auth/status", async (req) => {
    const users = Number((await db.admin.query("SELECT count(*) n FROM users")).rows[0].n);
    return { setupNeeded: users === 0, registration: await meta("registration", "invite"), user: req.user ? publicUser(req.user) : null, version: VERSION, apiLevel: API_LEVEL };
  });
  // the salt the device needs to derive its keys. A name without an account gets a stand-in salt that is the same
  // every time, so the answer never says whether the account exists.
  app.get("/api/auth/salt", async (req, reply) => {
    const name = String((req.query as any)?.username ?? "").toLowerCase();
    if (!validUsername(name)) return reply.code(400).send({ error: badName });
    const u = (await db.admin.query("SELECT kdf_salt FROM users WHERE username = $1", [name])).rows[0];
    return { kdfSalt: u?.kdf_salt ?? standInSalt(name, serverKey) };
  });
  // what opens the journal on the lock screen (PLAN.md §4.3): the same two values sign-in hands over, both useless
  // without the password. wrappedByPassword is null after an admin reset.
  app.get("/api/auth/bundle", async (req, reply) => {
    if (!need(req, reply)) return;
    const u = (await db.admin.query("SELECT kdf_salt, wrapped_by_password FROM users WHERE id = $1", [req.user!.id])).rows[0];
    return { kdfSalt: u.kdf_salt, wrappedByPassword: u.wrapped_by_password };
  });
  const signIn = async (req: FastifyRequest, reply: FastifyReply, id: string, b: any) => {
    const device = deviceLabel(b?.deviceName, req.headers["user-agent"]);
    const deviceId = validDeviceId(b?.deviceId) ? b.deviceId : null;
    await noteNewDevice(db, id, device, deviceId);
    const token = await createSession(db, id, device, String(b?.platform ?? "web"), deviceId);
    setCookie(req, reply, token);
    return b?.wantToken ? token : undefined;
  };
  // the first account is the admin and needs no invite; after that, who may join is the admin's setting
  app.post("/api/auth/sign-up", async (req, reply) => {
    const b = req.body as any;
    const first = Number((await db.admin.query("SELECT count(*) n FROM users")).rows[0].n) === 0;
    const mode = first ? "open" : await meta("registration", "invite");
    if (mode === "closed") return reply.code(403).send({ error: "Ask the admin for an invite" });
    if (!validUsername(b?.username)) return reply.code(400).send({ error: badName });
    if (!validAuthKey(b?.authKey) || !validSalt(b?.kdfSalt) || !validWrapped(b?.wrappedByPassword)) return reply.code(400).send({ error: badBundle });
    if (mode === "invite") {
      const inv = (await db.admin.query("SELECT code FROM invites WHERE code = $1 AND used_by IS NULL AND expires_at > now()", [String(b.invite ?? "")])).rows[0];
      if (!inv) return reply.code(403).send({ error: "That invite code is not valid" });
    }
    const name = b.username.toLowerCase();
    if ((await db.admin.query("SELECT 1 FROM users WHERE username = $1", [name])).rows.length) return reply.code(409).send({ error: "That username is taken" });
    const id = uuidv7();
    await db.admin.query("INSERT INTO users (id, username, role, display_name, kdf_salt, auth_hash, wrapped_by_password, password_changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now())",
      [id, name, first ? "admin" : "user", String(b.displayName ?? b.username).slice(0, 80), b.kdfSalt, await hashSecret(b.authKey), b.wrappedByPassword]);
    if (mode === "invite") await db.admin.query("UPDATE invites SET used_by = $2 WHERE code = $1", [b.invite, id]);
    return { ok: true, token: await signIn(req, reply, id, b) };
  });
  // Sign-in answers the wrapped data key with the session, so the device can open the journal with the encKey it
  // derived alongside authKey. With two-factor on it first answers { totpRequired: true } and waits for the same
  // request again with a code (an authenticator's, or a backup code, which is used up).
  app.post("/api/auth/sign-in", async (req, reply) => {
    const b = req.body as any;
    const name = String(b?.username ?? "").toLowerCase();
    const keys = [`ip:${req.ip}`, `u:${name}`];
    const release = reserveTry(keys); // a wrong try stays counted; only a right one takes it back
    if (!release) return reply.code(429).send({ error: "Too many tries. Wait 15 minutes." });
    const u = (await db.admin.query("SELECT id, auth_hash, disabled_at, kdf_salt, wrapped_by_password, totp_enabled, totp_secret FROM users WHERE username = $1", [name])).rows[0];
    const ok = await checkSecret(validAuthKey(b?.authKey) ? b.authKey : "", u?.auth_hash ?? null);
    if (!u || !ok || u.disabled_at) return reply.code(401).send({ error: "Wrong username or password" });
    if (u.totp_enabled) {
      const code = b?.code ?? b?.totp;
      if (code === undefined || code === null || code === "") { release(); return { ok: false, totpRequired: true }; }
      const good = (await useTotp(db, u.id, decryptForServer(u.totp_secret, serverKey), code)) || (await useBackupCode(db, u.id, code));
      if (!good) return reply.code(401).send({ error: "That code is not right" });
    }
    release();
    return { ok: true, totpRequired: false, kdfSalt: u.kdf_salt, wrappedByPassword: u.wrapped_by_password, token: await signIn(req, reply, u.id, b) };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    if (req.user) await db.admin.query("DELETE FROM sessions WHERE id = $1", [req.user.sessionId]);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
  app.get("/api/auth/sessions", async (req, reply) => {
    if (!need(req, reply)) return;
    const { rows } = await db.admin.query("SELECT id, device_name, platform, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC", [req.user!.id]);
    return rows.map((r: any) => ({ id: r.id, deviceName: r.device_name, platform: r.platform, createdAt: r.created_at, lastSeenAt: r.last_seen_at, current: r.id === req.user!.sessionId }));
  });
  app.delete("/api/auth/sessions/:id", async (req, reply) => {
    if (!need(req, reply)) return;
    await db.admin.query("DELETE FROM sessions WHERE id = $1 AND user_id = $2", [(req.params as any).id, req.user!.id]);
    return { ok: true };
  });
  app.post("/api/auth/logout-others", async (req, reply) => {
    if (!need(req, reply)) return;
    await db.admin.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2 AND platform <> 'api'", [req.user!.id, req.user!.sessionId]);
    return { ok: true };
  });
  // asking for the password again (changing it, turning two-factor off, deleting the account): the device sends the
  // current authKey; the same check and the same wait after too many tries as signing in, so a device left signed
  // in can't be used to guess it. A wrong one is a 403, not a 401: the app signs out on a 401, and a typo shouldn't.
  const recheck = async (req: FastifyRequest, reply: FastifyReply, authKey: unknown) => {
    const keys = [`ip:${req.ip}`, `u:${req.user!.username}`];
    const release = reserveTry(keys);
    if (!release) { reply.code(429).send({ error: "Too many tries. Wait 15 minutes." }); return false; }
    const u = (await db.admin.query("SELECT auth_hash FROM users WHERE id = $1", [req.user!.id])).rows[0];
    if (await checkSecret(validAuthKey(authKey) ? authKey : "", u?.auth_hash ?? null)) { release(); return true; }
    reply.code(403).send({ error: "Wrong password" });
    return false;
  };
  // a new password: the device re-derives the keys and re-wraps the data key (changePassword in @somnium/shared) and
  // sends the new bundle with the current authKey. The other devices are signed out.
  app.post("/api/auth/password", async (req, reply) => {
    if (!need(req, reply)) return;
    const b = req.body as any;
    if (!(await recheck(req, reply, b?.current))) return;
    if (!validAuthKey(b?.authKey) || !validSalt(b?.kdfSalt) || !validWrapped(b?.wrappedByPassword)) return reply.code(400).send({ error: badBundle });
    await db.admin.query("UPDATE users SET kdf_salt = $2, auth_hash = $3, wrapped_by_password = $4, password_changed_at = now(), reset_code_hash = NULL, reset_expires_at = NULL WHERE id = $1",
      [req.user!.id, b.kdfSalt, await hashSecret(b.authKey), b.wrappedByPassword]);
    await db.admin.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [req.user!.id, req.user!.sessionId]);
    await noteAccount(db, req.user!.id, "Password changed");
    return { ok: true };
  });
  // the way back in when the password is lost and the admin gave a reset code (PLAN.md §4.4): a new password, but
  // no wrapped data key - the journal stays sealed until a recovery key or a signed-in device re-wraps it
  app.post("/api/auth/reset", async (req, reply) => {
    const b = req.body as any;
    const name = String(b?.username ?? "").toLowerCase();
    const keys = [`ip:${req.ip}`, `u:${name}`];
    const release = reserveTry(keys);
    if (!release) return reply.code(429).send({ error: "Too many tries. Wait 15 minutes." });
    if (!validAuthKey(b?.authKey) || !validSalt(b?.kdfSalt)) { release(); return reply.code(400).send({ error: badBundle }); }
    const u = (await db.admin.query("SELECT id, reset_code_hash FROM users WHERE username = $1 AND reset_expires_at > now()", [name])).rows[0];
    const ok = await checkSecret(plainCode(b?.code), u?.reset_code_hash ?? null);
    if (!u || !ok) return reply.code(403).send({ error: "That reset code is not right or has run out" });
    // one statement, bound to the code that was checked: of two uses at once, only one finds it still there
    const used = await db.admin.query("UPDATE users SET kdf_salt = $2, auth_hash = $3, wrapped_by_password = NULL, password_changed_at = now(), reset_code_hash = NULL, reset_expires_at = NULL, totp_enabled = false, totp_secret = NULL, totp_last_step = NULL WHERE id = $1 AND reset_code_hash = $4 AND reset_expires_at > now() RETURNING id",
      [u.id, b.kdfSalt, await hashSecret(b.authKey), u.reset_code_hash]);
    if (!used.rows.length) return reply.code(403).send({ error: "That reset code is not right or has run out" });
    release();
    await db.admin.query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
    await db.admin.query("DELETE FROM backup_codes WHERE user_id = $1", [u.id]);
    await noteAccount(db, u.id, "Password set with a reset code. Two-factor sign-in is off.");
    return { ok: true, sealed: true, message: RESET_MESSAGE };
  });
  app.delete("/api/auth/account", async (req, reply) => {
    if (!need(req, reply)) return;
    const b = req.body as any;
    if (!(await recheck(req, reply, b?.authKey))) return;
    const u = (await db.admin.query("SELECT role FROM users WHERE id = $1", [req.user!.id])).rows[0];
    if (u.role === "admin" && Number((await db.admin.query("SELECT count(*) n FROM users WHERE role = 'admin'")).rows[0].n) === 1)
      return reply.code(400).send({ error: "You are the only admin. Make someone else admin first." });
    await db.admin.query("DELETE FROM users WHERE id = $1", [req.user!.id]);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  // ----- two-factor sign-in (Settings → Security) -----
  app.get("/api/auth/security", async (req, reply) => {
    if (!need(req, reply)) return;
    const u = (await db.admin.query("SELECT totp_enabled, recovery_made_at, password_changed_at, wrapped_by_password FROM users WHERE id = $1", [req.user!.id])).rows[0];
    const codes = Number((await db.admin.query("SELECT count(*) n FROM backup_codes WHERE user_id = $1 AND used_at IS NULL", [req.user!.id])).rows[0].n);
    return { totpEnabled: !!u.totp_enabled, backupCodesLeft: codes, recoveryMadeAt: u.recovery_made_at, passwordChangedAt: u.password_changed_at, sealed: !u.wrapped_by_password };
  });
  // a fresh secret, shown once as a QR code and as text; sign-in does not ask for codes until /enable confirms one.
  // It needs the password, and two-factor must be off: otherwise a device left signed in could swap the secret
  // (the condition is in the one UPDATE, so nothing can turn it on in between).
  app.post("/api/auth/2fa/start", async (req, reply) => {
    if (!need(req, reply)) return;
    if (!(await recheck(req, reply, (req.body as any)?.authKey))) return;
    const secret = newTotpSecret();
    const started = await db.admin.query("UPDATE users SET totp_secret = $2, totp_last_step = NULL WHERE id = $1 AND NOT totp_enabled RETURNING id", [req.user!.id, encryptForServer(secret, serverKey)]);
    if (!started.rows.length) return reply.code(409).send({ error: "Two-factor sign-in is already on. Turn it off first." });
    return { secret, url: otpauthUrl(req.user!.username, secret) };
  });
  app.post("/api/auth/2fa/enable", async (req, reply) => {
    if (!need(req, reply)) return;
    const u = (await db.admin.query("SELECT totp_secret, totp_enabled FROM users WHERE id = $1", [req.user!.id])).rows[0];
    if (!u.totp_secret || u.totp_enabled) return reply.code(400).send({ error: "Start by scanning a new code" });
    const step = totpOk(decryptForServer(u.totp_secret, serverKey), (req.body as any)?.code);
    if (step === null) return reply.code(403).send({ error: "That code is not right. Check the time on your phone and try the next one." });
    // bound to the secret that was checked: a /start in between has swapped it, and the new one is not confirmed yet
    const on = await db.admin.query("UPDATE users SET totp_enabled = true, totp_last_step = $2 WHERE id = $1 AND totp_secret = $3 AND NOT totp_enabled RETURNING id", [req.user!.id, step, u.totp_secret]);
    if (!on.rows.length) return reply.code(409).send({ error: "Start by scanning a new code" });
    await noteAccount(db, req.user!.id, "Two-factor sign-in turned on");
    return { ok: true, backupCodes: await issueBackupCodes(db, req.user!.id) };
  });
  app.post("/api/auth/2fa/codes", async (req, reply) => {
    if (!need(req, reply)) return;
    if (!(await recheck(req, reply, (req.body as any)?.authKey))) return;
    return { backupCodes: await issueBackupCodes(db, req.user!.id) };
  });
  app.post("/api/auth/2fa/disable", async (req, reply) => {
    if (!need(req, reply)) return;
    const b = req.body as any;
    if (!(await recheck(req, reply, b?.authKey))) return;
    const u = (await db.admin.query("SELECT totp_secret, totp_enabled FROM users WHERE id = $1", [req.user!.id])).rows[0];
    if (u.totp_enabled && !(await useTotp(db, req.user!.id, decryptForServer(u.totp_secret, serverKey), b?.code)) && !(await useBackupCode(db, req.user!.id, b?.code))) {
      recordFail([`ip:${req.ip}`, `u:${req.user!.username}`]); // the same count recheck looks at, so five wrong codes wait too
      return reply.code(403).send({ error: "That code is not right" });
    }
    await db.admin.query("UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL WHERE id = $1", [req.user!.id]);
    await db.admin.query("DELETE FROM backup_codes WHERE user_id = $1", [req.user!.id]);
    await noteAccount(db, req.user!.id, "Two-factor sign-in turned off");
    return { ok: true };
  });

  // ----- admin -----
  app.get("/api/admin/users", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const { rows } = await db.admin.query(
      `SELECT u.id, u.username, u.display_name, u.role, u.created_at, u.disabled_at, u.totp_enabled, (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at FROM users u ORDER BY u.created_at`);
    return rows.map((r: any) => ({ id: r.id, username: r.username, displayName: r.display_name, role: r.role, createdAt: r.created_at, disabled: !!r.disabled_at, totpEnabled: !!r.totp_enabled, lastSeenAt: r.last_seen_at }));
  });
  // Admins add people with invites (the server cannot make an account's keys: it never sees a password). For a
  // person who lost their password there is a one-time reset code (PLAN.md §4.4; the journal stays sealed), and
  // for one who lost their authenticator and backup codes, two-factor can be turned off.
  app.put("/api/admin/users/:id", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const b = req.body as any, id = (req.params as any).id;
    if (id === req.user!.id && (b.role === "user" || b.disabled)) return reply.code(400).send({ error: "You can't remove your own admin access" });
    if (!(await db.admin.query("SELECT 1 FROM users WHERE id = $1", [id])).rows.length) return reply.code(404).send({ error: "No such account" });
    let resetCode: string | undefined;
    if (b.resetPassword) { resetCode = await issueResetCode(db, id); await db.admin.query("DELETE FROM sessions WHERE user_id = $1", [id]); await noteAccount(db, id, "An admin made a password reset code"); }
    if (b.disable2fa) { await db.admin.query("UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL WHERE id = $1", [id]); await db.admin.query("DELETE FROM backup_codes WHERE user_id = $1", [id]); await noteAccount(db, id, "An admin turned two-factor sign-in off"); }
    if (b.role) await db.admin.query("UPDATE users SET role = $2 WHERE id = $1", [id, b.role === "admin" ? "admin" : "user"]);
    if (typeof b.disabled === "boolean") { await db.admin.query("UPDATE users SET disabled_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1", [id, b.disabled]); if (b.disabled) await db.admin.query("DELETE FROM sessions WHERE user_id = $1", [id]); }
    return { ok: true, resetCode };
  });
  app.delete("/api/admin/users/:id", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const id = (req.params as any).id;
    if (id === req.user!.id) return reply.code(400).send({ error: "Delete your own account from Settings → Account" });
    await db.admin.query("DELETE FROM users WHERE id = $1", [id]);
    return { ok: true };
  });
  app.get("/api/admin/settings", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const invites = (await db.admin.query("SELECT code, created_at, expires_at, used_by FROM invites ORDER BY created_at DESC LIMIT 20")).rows;
    return { registration: await meta("registration", "invite"), invites: invites.map((i: any) => ({ code: i.code, createdAt: i.created_at, expiresAt: i.expires_at, used: !!i.used_by })) };
  });
  app.put("/api/admin/settings", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const b = req.body as any;
    if (["closed", "invite", "open"].includes(b?.registration)) await setMeta("registration", b.registration);
    return { ok: true };
  });
  app.post("/api/admin/invites", async (req, reply) => {
    if (!needAdmin(req, reply)) return;
    const code = newInviteCode();
    await db.admin.query("INSERT INTO invites (code, created_by, expires_at) VALUES ($1,$2, now() + interval '14 days')", [code, req.user!.id]);
    return { code };
  });

  // ----- version and updates -----
  app.get("/api/version", async () => ({ version: VERSION, apiLevel: API_LEVEL }));
  app.get("/api/update-check", async () => checkForUpdate());

  // ----- live updates: one stream per signed-in person -----
  const streams = new Map<string, Set<FastifyReply>>();
  engine.onChange((userId, topics) => {
    for (const r of streams.get(userId) ?? []) r.raw.write(`event: change\ndata: ${JSON.stringify({ topics, at: Date.now() })}\n\n`);
  });
  app.get("/api/events", async (req, reply) => {
    if (!need(req, reply)) return;
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    reply.raw.write(`event: hello\ndata: {}\n\n`);
    const set = streams.get(req.user!.id) ?? new Set();
    streams.set(req.user!.id, set);
    set.add(reply);
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25000);
    req.raw.on("close", () => { clearInterval(ping); set.delete(reply); });
    return reply;
  });

  // ----- media: files people upload (journal photos and audio). A server only ever holds them sealed: the device
  // seals each one (apps/web/src/api/client.ts) and anything else is refused below. The kind, type and size stay plain. -----
  const mediaDir = path.join(o.dataDir, "media");
  fs.mkdirSync(mediaDir, { recursive: true });
  // the sealed file goes in the body; ?id= is the id it was sealed for (made on the device, since the seal is bound to
  // it); ?dreamId= hangs it on one of the person's live dreams. The row is written first and
  // the file only once that worked (a file without a row would be unreachable and never cleaned up).
  app.post("/api/media", async (req, reply) => {
    if (!need(req, reply)) return;
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) return reply.code(400).send({ error: "Send the file as the request body" });
    const sealedOnly = (o.mode ?? "server") === "server";
    if (sealedOnly && !isSealed(buf.toString("latin1"))) return reply.code(400).send({ error: "This file must be sealed by the app" });
    const mime = String(req.headers["content-type"]);
    const kind = mime.startsWith("video") ? "video" : mime.startsWith("audio") ? "audio" : "photo";
    const { dreamId: dreamParam, id: idParam } = req.query as Record<string, string | undefined>;
    const dreamId = dreamParam || null;
    if (dreamId && !isUuid(dreamId)) return reply.code(400).send({ error: "Invalid dream" });
    if (idParam ? !isUuid(idParam) : sealedOnly) return reply.code(400).send({ error: "Invalid file id" });
    const id = idParam || uuidv7();
    try {
      await withUser(db, req.user!.id, async (q) => {
        await visible(q, "dreams", dreamId, "dream");
        await q.query("INSERT INTO media (id, user_id, kind, mime, size, path, dream_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [id, req.user!.id, kind, mime, buf.length, `${req.user!.id}/${id}`, dreamId]);
      });
    } catch (e) {
      if (e instanceof HttpError) return reply.code(e.status).send({ error: e.message });
      if (/duplicate key|violates unique/.test((e as Error).message)) return reply.code(400).send({ error: "Invalid file id" });
      throw e;
    }
    const dir = path.join(mediaDir, req.user!.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, id), buf, { mode: 0o600 });
    return { id, url: `/api/media/${id}` };
  });
  app.get("/api/media/:id", async (req, reply) => {
    if (!need(req, reply)) return;
    const id = (req.params as any).id;
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply.code(404).send();
    const m = await withUser(db, req.user!.id, async (q) => (await q.query("SELECT mime FROM media WHERE id = $1 AND deleted_at IS NULL", [id])).rows[0]);
    if (!m) return reply.code(404).send({ error: "Not found" });
    // Where a file lives comes from who asks and which row, as in the upload above, never from the row's path column:
    // sync push can set that column to anything, including a way out of the media folder.
    const file = path.join(mediaDir, req.user!.id, id);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: "Not found" });
    reply.header("content-type", m.mime).header("cache-control", "private, max-age=31536000, immutable");
    return reply.send(fs.createReadStream(file));
  });

  // ----- everything else under /api: the engine -----
  app.all("/api/*", async (req, reply) => {
    if (!need(req, reply)) return;
    const url = new URL(req.url, "http://x");
    const res = await engine.handle({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: req.body, userId: req.user!.id });
    return reply.code(res.status).send(res.body);
  });

  // ----- the web app -----
  if (o.webDir && fs.existsSync(o.webDir)) {
    // files are looked up on each request (a rebuild adds new ones); built files have content-hashed names, so they can be kept for good
    await app.register(fstatic, { root: o.webDir, prefix: "/", wildcard: true, decorateReply: true, cacheControl: false,
      setHeaders: (res, file) => res.setHeader("cache-control", /[\\/]assets[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache") });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") ? reply.code(404).send({ error: "Not found" }) : reply.type("text/html").sendFile("index.html")));
  }
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ServerKeyError) { req.log.error(err.message); return reply.code(500).send({ error: err.message }); }
    req.log.error(err);
    reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({ error: err.statusCode && err.statusCode < 500 ? err.message : "Something went wrong on the server" });
  });
  return { app, engine };
}

export const randomId = () => crypto.randomUUID();
