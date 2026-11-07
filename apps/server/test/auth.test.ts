// Sign-in with the auth key (PLAN.md §4.1-4.2): the server only ever sees authKey, checks it, and hands back the
// salt and the wrapped data key; two-factor sign-in with an authenticator code or a one-time backup code; a
// password change signs the other devices out; too many wrong tries wait.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { pgliteDb } from "@somnium/engine/pglite";
import { uuidv7, type Db } from "@somnium/engine";
import { createAccountKeys, changePassword, openWithPassword, toBase64url, fromBase64url, sealColumn } from "@somnium/shared";
import { buildApp } from "../src/app";
import { totp, forgetFails, failKeyCount, recordFail, reserveTry, nameWait, keyFromFile, makeDataDir, encryptForServer, decryptForServer, loadServerKey } from "../src/auth";

let app: FastifyInstance, db: Db, dir: string;
let ann: { authKey: string }; // the first account (the admin), used by the admin test
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: "POST", url: "/api" + url, payload, headers });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const signedIn = async (h: Record<string, string>) => (await app.inject({ method: "GET", url: "/api/auth/sessions", headers: h })).statusCode === 200;

async function signUp(username: string, password: string, extra: Record<string, unknown> = {}) {
  const keys = await createAccountKeys(password);
  const r = await post("/auth/sign-up", { username, authKey: keys.authKey, kdfSalt: keys.salt, wrappedByPassword: keys.wrappedByPassword, wantToken: true, ...extra });
  return { keys, r, h: bearer(r.json().token) };
}
async function signIn(username: string, authKey: string, extra: Record<string, unknown> = {}) {
  return post("/auth/sign-in", { username, authKey, wantToken: true, deviceName: "Test runner", ...extra });
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "somnium-auth-test-"));
  db = await pgliteDb("memory://");
  ({ app } = await buildApp({ db, dataDir: dir }));
}, 120000);
afterAll(async () => { await app.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => forgetFails(db));

describe("sign-up and sign-in with the auth key", () => {
  it("makes the first account the admin, signs in with authKey and hands back the bundle, refuses a wrong key", async () => {
    const { keys, r } = await signUp("ann", "correct horse battery");
    ann = keys;
    expect(r.statusCode).toBe(200);
    expect((await db.admin.query("SELECT role, auth_hash FROM users WHERE username = 'ann'")).rows[0]).toMatchObject({ role: "admin" });
    expect((await db.admin.query("SELECT auth_hash FROM users WHERE username = 'ann'")).rows[0].auth_hash).not.toContain(keys.authKey);

    const ok = await signIn("ann", keys.authKey);
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body).toMatchObject({ ok: true, totpRequired: false, kdfSalt: keys.salt, wrappedByPassword: keys.wrappedByPassword });
    // the bundle the server hands back opens the same data key on the device
    expect(toBase64url(await openWithPassword({ salt: body.kdfSalt, wrappedByPassword: body.wrappedByPassword }, "correct horse battery"))).toBe(toBase64url(keys.dataKey));

    const other = await createAccountKeys("correct horse battery"); // a different salt: a different authKey
    expect((await signIn("ann", other.authKey)).statusCode).toBe(401);
    expect((await signIn("ann", "not-a-key")).statusCode).toBe(401);
  });

  it("hands the signed-in account its bundle for the lock screen, and nobody else", async () => {
    expect((await app.inject({ method: "GET", url: "/api/auth/bundle" })).statusCode).toBe(401);
    const answer = (await signIn("ann", ann.authKey)).json();
    const r = await app.inject({ method: "GET", url: "/api/auth/bundle", headers: bearer(answer.token) });
    expect(r.statusCode).toBe(200);
    // the recovery wrap too (null until a recovery key is made), so backups open with the recovery key (LDJ-35)
    expect(r.json()).toEqual({ kdfSalt: answer.kdfSalt, wrappedByPassword: answer.wrappedByPassword, recoverySalt: null, wrappedByRecovery: null });
    expect(answer.wrappedByPassword).toBeTruthy();
  });

  it("writes an activity-log note for a new device, once", async () => {
    const { keys, r } = await signUp("dev", "correct horse battery", { deviceName: "Phone one", invite: await invite() });
    await signIn("dev", keys.authKey, { deviceName: "Phone one" });
    await signIn("dev", keys.authKey, { deviceName: "Phone two" });
    const { rows } = await db.admin.query("SELECT text FROM account_events WHERE user_id = (SELECT id FROM users WHERE username = 'dev') ORDER BY at");
    expect(rows.map((x: any) => x.text)).toEqual(["Signed in on Phone one", "Signed in on Phone two"]);
    const log = await app.inject({ method: "GET", url: "/api/activity-log", headers: bearer(r.json().token) });
    expect(log.json().entries.map((e: any) => e.text)).toContain("Signed in on Phone two");
  });

  it("needs an invite once an account exists, and checks the bundle's shape", async () => {
    const keys = await createAccountKeys("correct horse battery");
    const bundle = { username: "bob", authKey: keys.authKey, kdfSalt: keys.salt, wrappedByPassword: keys.wrappedByPassword };
    expect((await post("/auth/sign-up", bundle)).statusCode).toBe(403);
    expect((await post("/auth/sign-up", { ...bundle, invite: "nope" })).statusCode).toBe(403);
    const admin = (await signIn("ann", (await createAccountKeys("x")).authKey)); // wrong key: no session
    expect(admin.statusCode).toBe(401);
    await db.admin.query("INSERT INTO invites (code, expires_at) VALUES ('letmein', now() + interval '1 day')");
    expect((await post("/auth/sign-up", { ...bundle, invite: "letmein", authKey: "short" })).statusCode).toBe(400);
    expect((await post("/auth/sign-up", { ...bundle, invite: "letmein" })).statusCode).toBe(200);
    expect((await post("/auth/sign-up", { ...bundle, invite: "letmein" })).statusCode).toBe(403); // used
  });

  it("gives every name a salt, so names cannot be listed", async () => {
    const real = await app.inject({ method: "GET", url: "/api/auth/salt?username=ann" });
    const fake1 = await app.inject({ method: "GET", url: "/api/auth/salt?username=nobody" });
    const fake2 = await app.inject({ method: "GET", url: "/api/auth/salt?username=nobody" });
    expect(real.statusCode).toBe(200);
    expect(fake1.statusCode).toBe(200);
    expect(fromBase64url(real.json().kdfSalt).length).toBe(16);
    expect(fromBase64url(fake1.json().kdfSalt).length).toBe(16);
    expect(fake1.json().kdfSalt).toBe(fake2.json().kdfSalt);
    expect(fake1.json().kdfSalt).not.toBe((await app.inject({ method: "GET", url: "/api/auth/salt?username=nobody2" })).json().kdfSalt);
  });

  it("waits after five wrong tries", async () => {
    const { keys } = await signUp("lock", "correct horse battery", { invite: await invite() });
    for (let i = 0; i < 5; i++) expect((await signIn("lock", (await createAccountKeys("x")).authKey)).statusCode).toBe(401);
    expect((await signIn("lock", keys.authKey)).statusCode).toBe(429);
  });
});

const forgetLastStep = (username: string) => db.admin.query("UPDATE users SET totp_last_step = NULL WHERE username = $1", [username]);
/** A new account with two-factor on. Its last step is forgotten, so a test can use the current code right away. */
async function withTwoFactor(username: string) {
  const { keys, h } = await signUp(username, "correct horse battery", { invite: await invite() });
  const { secret } = (await post("/auth/2fa/start", { authKey: keys.authKey }, h)).json();
  const codes: string[] = (await post("/auth/2fa/enable", { code: totp(secret) }, h)).json().backupCodes;
  await forgetLastStep(username);
  return { keys, h, secret, codes };
}
const notes = async (username: string): Promise<string[]> =>
  (await db.admin.query("SELECT text FROM account_events WHERE user_id = (SELECT id FROM users WHERE username = $1) ORDER BY at, id", [username])).rows.map((x: any) => x.text);
const asAdmin = async () => bearer((await signIn("ann", ann.authKey)).json().token);
const idOf = async (username: string) => (await db.admin.query("SELECT id FROM users WHERE username = $1", [username])).rows[0].id;

async function invite() { const code = "inv" + Math.random().toString(36).slice(2); await db.admin.query("INSERT INTO invites (code, expires_at) VALUES ($1, now() + interval '1 day')", [code]); return code; }

describe("two-factor sign-in", () => {
  it("asks for a code once enabled, takes an authenticator code or a backup code once, and turns off with a code", async () => {
    const { keys, h } = await signUp("two", "correct horse battery", { invite: await invite() });
    expect((await post("/auth/2fa/start", {}, h)).statusCode).toBe(403); // needs the password
    const start = (await post("/auth/2fa/start", { authKey: keys.authKey }, h)).json();
    expect(start.url).toContain("otpauth://totp/Somnium:two?secret=" + start.secret);
    const stored = (await db.admin.query("SELECT totp_secret FROM users WHERE username = 'two'")).rows[0].totp_secret;
    expect(stored).not.toContain(start.secret); // encrypted with the server's key
    expect(decryptForServer(stored, loadServerKey(dir))).toBe(start.secret);
    expect((await post("/auth/2fa/enable", { code: "000000" }, h)).statusCode).toBe(403);
    const on = await post("/auth/2fa/enable", { code: totp(start.secret) }, h);
    expect(on.statusCode).toBe(200);
    const codes: string[] = on.json().backupCodes;
    expect(codes).toHaveLength(8);
    expect(codes.every((c) => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c))).toBe(true);

    expect((await signIn("two", keys.authKey)).json()).toMatchObject({ ok: false, totpRequired: true });
    expect((await signIn("two", keys.authKey, { code: "123456" })).statusCode).toBe(401);
    await forgetLastStep("two"); // a code works once, and the one above just turned two-factor on
    const withTotp = await signIn("two", keys.authKey, { totp: totp(start.secret) });
    expect(withTotp.statusCode).toBe(200);
    expect(withTotp.json().wrappedByPassword).toBe(keys.wrappedByPassword);
    const withBackup = await signIn("two", keys.authKey, { code: codes[0]!.toLowerCase() });
    expect(withBackup.statusCode).toBe(200);
    expect((await signIn("two", keys.authKey, { code: codes[0] })).statusCode).toBe(401); // used up
    expect((await app.inject({ method: "GET", url: "/api/auth/security", headers: h })).json()).toMatchObject({ totpEnabled: true, backupCodesLeft: 7 });

    expect((await post("/auth/2fa/disable", { authKey: keys.authKey, code: "000000" }, h)).statusCode).toBe(403);
    await forgetLastStep("two");
    expect((await post("/auth/2fa/disable", { authKey: keys.authKey, code: totp(start.secret) }, h)).statusCode).toBe(200);
    expect((await signIn("two", keys.authKey)).json()).toMatchObject({ ok: true, totpRequired: false });
    expect((await app.inject({ method: "GET", url: "/api/auth/security", headers: h })).json()).toMatchObject({ totpEnabled: false, backupCodesLeft: 0 });
  });
});

describe("changing the password", () => {
  it("takes the re-wrapped bundle with the current authKey and signs the other devices out", async () => {
    const { keys, h } = await signUp("pw", "correct horse battery", { invite: await invite() });
    const other = bearer((await signIn("pw", keys.authKey)).json().token);
    const next = await changePassword(keys.dataKey, "another fine password");
    const bundle = { authKey: next.authKey, kdfSalt: next.salt, wrappedByPassword: next.wrappedByPassword };
    expect((await post("/auth/password", { current: "wrong", ...bundle }, h)).statusCode).toBe(403);
    expect(await signedIn(h)).toBe(true);
    expect((await post("/auth/password", { current: keys.authKey, ...bundle }, h)).statusCode).toBe(200);
    expect(await signedIn(h)).toBe(true);
    expect(await signedIn(other)).toBe(false);
    expect((await signIn("pw", keys.authKey)).statusCode).toBe(401);
    const again = await signIn("pw", next.authKey);
    expect(again.statusCode).toBe(200);
    expect(toBase64url(await openWithPassword({ salt: again.json().kdfSalt, wrappedByPassword: again.json().wrappedByPassword }, "another fine password"))).toBe(toBase64url(keys.dataKey));
  });

  it("admin reset: a one-time code sets a new password and leaves the journal sealed", async () => {
    const { keys } = await signUp("lost", "correct horse battery", { invite: await invite() });
    const adminH = bearer((await signIn("ann", ann.authKey)).json().token);
    const id = (await db.admin.query("SELECT id FROM users WHERE username = 'lost'")).rows[0].id;
    const reset = await app.inject({ method: "PUT", url: `/api/admin/users/${id}`, headers: adminH, payload: { resetPassword: true } });
    expect(reset.statusCode).toBe(200);
    const code: string = reset.json().resetCode;
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const fresh = await createAccountKeys("a brand new password");
    expect((await post("/auth/reset", { username: "lost", code: "AAAAA-AAAAA", authKey: fresh.authKey, kdfSalt: fresh.salt })).statusCode).toBe(403);
    const done = await post("/auth/reset", { username: "lost", code, authKey: fresh.authKey, kdfSalt: fresh.salt });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ ok: true, sealed: true, message: "Your password is set. Your journal stays sealed until you enter your recovery key." });
    expect((await post("/auth/reset", { username: "lost", code, authKey: fresh.authKey, kdfSalt: fresh.salt })).statusCode).toBe(403); // one-time
    expect((await signIn("lost", keys.authKey)).statusCode).toBe(401);
    const r = await signIn("lost", fresh.authKey);
    expect(r.statusCode).toBe(200);
    expect(r.json().wrappedByPassword).toBeNull();
  });
});

describe("a code only counts once, and wrong codes wait", () => {
  it("refuses /2fa/start while two-factor is on, and keeps the secret", async () => {
    const { keys, h } = await withTwoFactor("starton");
    const before = (await db.admin.query("SELECT totp_secret FROM users WHERE username = 'starton'")).rows[0].totp_secret;
    expect((await post("/auth/2fa/start", { authKey: keys.authKey }, h)).statusCode).toBe(409);
    expect((await post("/auth/2fa/start", {}, h)).statusCode).toBe(403);
    const after = (await db.admin.query("SELECT totp_secret, totp_enabled FROM users WHERE username = 'starton'")).rows[0];
    expect(after).toMatchObject({ totp_secret: before, totp_enabled: true });
  });

  it("refuses the same authenticator code the second time, at sign-in and at /2fa/disable", async () => {
    const { keys, h, secret } = await withTwoFactor("replay");
    const code = totp(secret);
    expect((await signIn("replay", keys.authKey, { code })).statusCode).toBe(200);
    expect((await signIn("replay", keys.authKey, { code })).statusCode).toBe(401);
    expect((await post("/auth/2fa/disable", { authKey: keys.authKey, code }, h)).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/auth/security", headers: h })).json().totpEnabled).toBe(true);
  });

  it("refuses the code that turned two-factor on", async () => {
    const { keys, h } = await signUp("enabled", "correct horse battery", { invite: await invite() });
    const { secret } = (await post("/auth/2fa/start", { authKey: keys.authKey }, h)).json();
    const code = totp(secret);
    expect((await post("/auth/2fa/enable", { code }, h)).statusCode).toBe(200);
    expect((await signIn("enabled", keys.authKey, { code })).statusCode).toBe(401);
  });

  it("waits after five wrong codes at sign-in, even for the right one", async () => {
    const { keys, secret } = await withTwoFactor("lock2fa");
    for (let i = 0; i < 5; i++) expect((await signIn("lock2fa", keys.authKey, { code: "000000" })).statusCode).toBe(401);
    expect((await signIn("lock2fa", keys.authKey, { code: totp(secret) })).statusCode).toBe(429);
  });

  it("waits after five wrong codes at /2fa/disable, wrong backup codes included", async () => {
    const { keys, h, secret } = await withTwoFactor("lockoff");
    for (let i = 0; i < 5; i++) expect((await post("/auth/2fa/disable", { authKey: keys.authKey, code: i % 2 ? "AAAAA-AAAAA" : "000000" }, h)).statusCode).toBe(403);
    expect((await post("/auth/2fa/disable", { authKey: keys.authKey, code: totp(secret) }, h)).statusCode).toBe(429);
    expect((await app.inject({ method: "GET", url: "/api/auth/security", headers: h })).json().totpEnabled).toBe(true);
  });

  it("waits after five wrong reset codes", async () => {
    const fresh = await createAccountKeys("a brand new password");
    const b = { username: "ann", code: "AAAAA-AAAAA", authKey: fresh.authKey, kdfSalt: fresh.salt };
    for (let i = 0; i < 5; i++) expect((await post("/auth/reset", b)).statusCode).toBe(403);
    expect((await post("/auth/reset", b)).statusCode).toBe(429);
  });

  it("refuses an expired reset code", async () => {
    await signUp("late", "correct horse battery", { invite: await invite() });
    const id = await idOf("late");
    const { resetCode } = (await app.inject({ method: "PUT", url: `/api/admin/users/${id}`, headers: await asAdmin(), payload: { resetPassword: true } })).json();
    await db.admin.query("UPDATE users SET reset_expires_at = now() - interval '1 minute' WHERE id = $1", [id]);
    const fresh = await createAccountKeys("a brand new password");
    expect((await post("/auth/reset", { username: "late", code: resetCode, authKey: fresh.authKey, kdfSalt: fresh.salt })).statusCode).toBe(403);
  });

  it("forgets keys whose tries have run out, not only the ones asked about, and cuts long names to size", async () => {
    await recordFail(db, "10.9.9.9", "someone");
    await recordFail(db, "10.9.9.9", "x".repeat(100000));
    expect(await failKeyCount(db)).toBe(3); // one address, two names
    expect((await db.admin.query("SELECT max(length(key))::int AS n FROM sign_in_tries")).rows[0].n).toBe(64);
    await db.admin.query("UPDATE sign_in_tries SET at = at - interval '16 minutes'");
    const t = await reserveTry(db, "10.9.9.8", "someone-else");
    expect("release" in t).toBe(true);
    expect(await failKeyCount(db)).toBe(2); // only the try just reserved
  });
});

describe("sign-in tries kept in the database (LDJ-59)", () => {
  const from = (remoteAddress: string, username: string, authKey: string) =>
    app.inject({ method: "POST", url: "/api/auth/sign-in", remoteAddress, payload: { username, authKey, wantToken: true } });
  const later = (s: number) => db.admin.query(`UPDATE sign_in_tries SET at = at - interval '${s} seconds'`);

  it("still waits after a restart: a new server on the same database remembers the tries", async () => {
    const { keys } = await signUp("restart", "correct horse battery", { invite: await invite() });
    await forgetFails(db);
    const wrong = await createAccountKeys("not the password at all");
    for (let i = 0; i < 5; i++) expect((await from("10.1.0.1", "restart", wrong.authKey)).statusCode).toBe(401);
    const next = await buildApp({ db, dataDir: dir });
    try {
      const r = await next.app.inject({ method: "POST", url: "/api/auth/sign-in", remoteAddress: "10.1.0.1", payload: { username: "restart", authKey: keys.authKey } });
      expect(r.statusCode).toBe(429);
      expect(Number(r.headers["retry-after"])).toBeGreaterThan(800);
    } finally { await next.app.close(); }
  });

  it("an address gets five wrong tries in all, whichever names it tries", async () => {
    const wrong = await createAccountKeys("not the password at all");
    for (let i = 0; i < 5; i++) expect((await from("10.2.0.1", `name${i}`, wrong.authKey)).statusCode).toBe(401);
    expect((await from("10.2.0.1", "ann", ann.authKey)).statusCode).toBe(429);
    expect((await from("10.2.0.2", "ann", ann.authKey)).statusCode).toBe(200); // another address is not held up
  });

  it("a stranger guessing from many addresses slows a name down but can't lock its owner out", async () => {
    const { keys } = await signUp("owner", "correct horse battery", { invite: await invite() });
    await forgetFails(db);
    const wrong = await createAccountKeys("not the password at all");
    // forty guesses from eight addresses, five each (each under its own limit); a refused one waits as told, then goes on
    let refused = 0;
    for (let i = 0; i < 40; i++) {
      const r = await from(`10.3.0.${i % 8}`, "owner", wrong.authKey);
      if (r.statusCode === 429) { refused++; expect(r.json().retryAfter).toBeLessThanOrEqual(30); await later(31); }
      else expect(r.statusCode).toBe(401);
    }
    expect(refused).toBeGreaterThan(0); // the name did slow down
    // right after a guess the owner is asked to wait, at most half a minute
    expect((await from("10.3.1.1", "owner", wrong.authKey)).statusCode).toBe(401);
    const held = await from("10.4.0.1", "owner", keys.authKey);
    expect(held.statusCode).toBe(429);
    expect(held.json().retryAfter).toBeLessThanOrEqual(30);
    expect(held.json().error).toMatch(/Wait \d+ seconds?/);
    await later(30);
    expect((await from("10.4.0.1", "owner", keys.authKey)).statusCode).toBe(200);
  });

  it("the wait per name grows 1 s, 2 s, 4 s ... after five tries, and stops at 30 s", () => {
    expect([0, 4, 5, 6, 7, 9, 10, 50].map(nameWait)).toEqual([0, 0, 1, 2, 4, 16, 30, 30]);
  });
});

describe("security headers (LDJ-59)", () => {
  it("every answer carries the strict policy, with the hashes of index.html's inline blocks", async () => {
    const web = fs.mkdtempSync(path.join(os.tmpdir(), "somnium-web-test-"));
    const body = "document.documentElement.dataset.x='1'";
    fs.writeFileSync(path.join(web, "index.html"), `<!doctype html><html><head><script>${body}</script><style>b{}</style></head><body><script type="module" src="/a.js"></script></body></html>`);
    const served = await buildApp({ db, dataDir: dir, webDir: web });
    try {
      for (const url of ["/", "/journal", "/api/auth/status", "/api/nowhere"]) {
        const r = await served.app.inject({ method: "GET", url });
        const csp = String(r.headers["content-security-policy"]);
        expect(csp, url).toContain("default-src 'self'");
        expect(csp, url).toContain(`'sha256-${crypto.createHash("sha256").update(body).digest("base64")}'`);
        expect(csp, url).toContain(`style-src 'self' 'sha256-${crypto.createHash("sha256").update("b{}").digest("base64")}'`);
        expect(csp, url).toContain("frame-ancestors 'none'");
        expect(csp, url).not.toContain("'unsafe-eval'");
        expect(r.headers["referrer-policy"]).toBe("no-referrer");
        expect(r.headers["cross-origin-opener-policy"]).toBe("same-origin");
        expect(r.headers["x-content-type-options"]).toBe("nosniff");
        expect(String(r.headers["permissions-policy"])).toContain("camera=(self), microphone=(self)");
      }
    } finally { await served.app.close(); fs.rmSync(web, { recursive: true, force: true }); }
  });
});

describe("who may ask", () => {
  it("refuses a cookie sign-in without the X-Somnium header, and sets the cookie SameSite=Strict", async () => {
    const r = await signIn("ann", ann.authKey);
    expect(String(r.headers["set-cookie"])).toContain("SameSite=Strict");
    const cookies = { somnium_session: r.json().token };
    expect((await app.inject({ method: "POST", url: "/api/auth/logout-others", cookies, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/auth/logout-others", cookies, payload: {}, headers: { "x-somnium": "1" } })).statusCode).toBe(200);
    expect((await post("/auth/logout-others", {}, bearer(r.json().token))).statusCode).toBe(200); // the apps' bearer token needs no header
  });

  it("refuses /api/admin/* to someone who is not an admin", async () => {
    const { h } = await signUp("plain", "correct horse battery", { invite: await invite() });
    const id = await idOf("ann");
    for (const [method, url] of [["GET", "/admin/users"], ["GET", "/admin/settings"], ["PUT", "/admin/settings"], ["POST", "/admin/invites"], ["PUT", `/admin/users/${id}`], ["DELETE", `/admin/users/${id}`]] as const)
      expect((await app.inject({ method, url: "/api" + url, headers: h, payload: {} })).statusCode, `${method} ${url}`).toBe(403);
  });
});

describe("the activity log", () => {
  const A = "a".repeat(32), B = "b".repeat(32);

  it("notes a new device once per device id, even after signing out, and whatever its label says", async () => {
    const { keys } = await signUp("ids", "correct horse battery", { invite: await invite(), deviceName: "Laptop", deviceId: A });
    const again = await signIn("ids", keys.authKey, { deviceName: "Laptop", deviceId: A });
    await post("/auth/logout", {}, bearer(again.json().token));
    await signIn("ids", keys.authKey, { deviceName: "A new name", deviceId: A });
    expect(await notes("ids")).toEqual(["Signed in on Laptop"]);
    await signIn("ids", keys.authKey, { deviceName: "Laptop", deviceId: B }); // the same label, another device
    expect(await notes("ids")).toEqual(["Signed in on Laptop", "Signed in on Laptop"]);
    const { rows } = await db.admin.query("SELECT device_id FROM sessions WHERE user_id = $1", [await idOf("ids")]);
    expect(rows.map((x: any) => x.device_id).sort()).toEqual([A, A, B]);
  });

  it("cuts a long label to 80 characters", async () => {
    await signUp("longname", "correct horse battery", { invite: await invite(), deviceName: "x".repeat(500), deviceId: A });
    expect(await notes("longname")).toEqual(["Signed in on " + "x".repeat(80)]);
  });

  it("notes changes to the sign-in: two-factor on and off, a new password, and what an admin did", async () => {
    const { keys, h, secret } = await withTwoFactor("logged");
    expect((await post("/auth/2fa/disable", { authKey: keys.authKey, code: totp(secret) }, h)).statusCode).toBe(200);
    const next = await changePassword(keys.dataKey, "another fine password");
    expect((await post("/auth/password", { current: keys.authKey, authKey: next.authKey, kdfSalt: next.salt, wrappedByPassword: next.wrappedByPassword }, h)).statusCode).toBe(200);
    const id = await idOf("logged"), headers = await asAdmin();
    await app.inject({ method: "PUT", url: `/api/admin/users/${id}`, headers, payload: { disable2fa: true } });
    const { resetCode } = (await app.inject({ method: "PUT", url: `/api/admin/users/${id}`, headers, payload: { resetPassword: true } })).json();
    const fresh = await createAccountKeys("a brand new password");
    await post("/auth/reset", { username: "logged", code: resetCode, authKey: fresh.authKey, kdfSalt: fresh.salt });
    expect(await notes("logged")).toEqual(expect.arrayContaining(["Two-factor sign-in turned on", "Two-factor sign-in turned off", "Password changed", "An admin turned two-factor sign-in off", "An admin made a password reset code", "Password set with a reset code. Two-factor sign-in is off."]));
  });
});

describe("the server's key", () => {
  it("makes the key file once, private, and warns about one others can read, without showing the key", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "somnium-key-test-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const made = keyFromFile(d), f = path.join(d, "app.key");
      expect(fs.statSync(f).mode & 0o777).toBe(0o600);
      expect(keyFromFile(d).equals(made)).toBe(true); // the file was there: kept
      expect(warn).not.toHaveBeenCalled();
      fs.chmodSync(f, 0o644);
      expect(keyFromFile(d).equals(made)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).not.toContain(made.toString("base64"));
    } finally { warn.mockRestore(); fs.rmSync(d, { recursive: true, force: true }); }
  });

  it("says so plainly when a secret was encrypted with another key", async () => {
    const { keys, secret } = await withTwoFactor("rekeyed");
    await db.admin.query("UPDATE users SET totp_secret = $1 WHERE username = 'rekeyed'", [encryptForServer(secret, crypto.randomBytes(32))]);
    const r = await signIn("rekeyed", keys.authKey, { code: "123456" });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: "Server key missing or changed" });
  });
});

describe("media", () => {
  it("takes an audio upload, codec parameter included, and every answer says nosniff", async () => {
    const { keys, h } = await signUp("voice", "correct horse battery", { invite: await invite() });
    const id = uuidv7();
    const payload = Buffer.from(await sealColumn(new TextEncoder().encode("a recording"), keys.dataKey, "media", "data", id)); // as the app sends it
    const up = await app.inject({ method: "POST", url: `/api/media?id=${id}`, headers: { ...h, "content-type": "audio/webm;codecs=opus" }, payload });
    expect(up.statusCode).toBe(200);
    expect(up.headers["x-content-type-options"]).toBe("nosniff");
    const down = await app.inject({ method: "GET", url: up.json().url, headers: h });
    expect(down.statusCode).toBe(200);
    expect(down.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("requests sent at the same moment", () => {
  it("a parallel burst of wrong passwords stops at five", async () => {
    const { keys } = await signUp("burst", "correct horse battery", { invite: await invite() });
    await forgetFails(db);
    const wrong = await createAccountKeys("not the password at all");
    const codes = (await Promise.all(Array.from({ length: 9 }, () => signIn("burst", wrong.authKey)))).map((r) => r.statusCode).sort();
    expect(codes).toEqual([401, 401, 401, 401, 401, 429, 429, 429, 429]);
    expect((await signIn("burst", keys.authKey)).statusCode).toBe(429);
  });

  it("a right password takes its try back, however often it is used", async () => {
    const { keys, h } = await signUp("right", "correct horse battery", { invite: await invite() });
    await forgetFails(db);
    for (let i = 0; i < 7; i++) expect((await signIn("right", keys.authKey)).statusCode).toBe(200);
    expect((await post("/auth/2fa/codes", { authKey: keys.authKey }, h)).statusCode).toBe(200);
    expect(await failKeyCount(db)).toBe(0);
    const t = await reserveTry(db, "10.5.0.1", "x");
    if (!("release" in t)) throw new Error("refused");
    for (let i = 0; i < 4; i++) expect("release" in (await reserveTry(db, "10.5.0.1", "x"))).toBe(true);
    expect("wait" in (await reserveTry(db, "10.5.0.1", "x"))).toBe(true);
    await t.release(); await t.release(); // twice counts once
    expect(await failKeyCount(db)).toBe(2);
    expect((await db.admin.query("SELECT count(*)::int AS n FROM sign_in_tries")).rows[0].n).toBe(8);
  });

  it("one reset code works once, even for two uses at the same moment", async () => {
    const { keys } = await signUp("resetrace", "correct horse battery", { invite: await invite() });
    const id = await idOf("resetrace");
    const { resetCode } = (await app.inject({ method: "PUT", url: `/api/admin/users/${id}`, headers: await asAdmin(), payload: { resetPassword: true } })).json();
    const one = await createAccountKeys("the first new password"), two = await createAccountKeys("the second new password");
    const answers = await Promise.all([one, two].map((k) => post("/auth/reset", { username: "resetrace", code: resetCode, authKey: k.authKey, kdfSalt: k.salt })));
    expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    await forgetFails(db);
    const winner = answers[0]!.statusCode === 200 ? one : two, loser = winner === one ? two : one;
    expect((await signIn("resetrace", winner.authKey)).statusCode).toBe(200);
    expect((await signIn("resetrace", loser.authKey)).statusCode).toBe(401);
    expect((await signIn("resetrace", keys.authKey)).statusCode).toBe(401);
  });

  it("enabling two-factor can't turn on a secret that a new start put there after the check", async () => {
    const { keys, h } = await signUp("enablerace", "correct horse battery", { invite: await invite() });
    const { secret } = (await post("/auth/2fa/start", { authKey: keys.authKey }, h)).json();
    // a /start landing right between enable's read and its write
    const admin = db.admin as unknown as { query: (sql: string, params?: unknown[]) => Promise<any> };
    const real = admin.query.bind(admin);
    const spy = vi.spyOn(admin, "query").mockImplementation(async (sql: string, params?: unknown[]) => {
      const out = await real(sql, params);
      if (sql.startsWith("SELECT totp_secret, totp_enabled")) await real("UPDATE users SET totp_secret = 'v1:swapped' WHERE id = $1", params);
      return out;
    });
    try { expect((await post("/auth/2fa/enable", { code: totp(secret) }, h)).statusCode).toBe(409); }
    finally { spy.mockRestore(); }
    const u = (await db.admin.query("SELECT totp_enabled, totp_secret FROM users WHERE username = 'enablerace'")).rows[0];
    expect(u).toEqual({ totp_enabled: false, totp_secret: "v1:swapped" });
  });
});

describe("the data folder and the key file", () => {
  const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "somnium-dir-test-"));

  it("a new folder is private; an existing one keeps its mode", () => {
    const d = scratch();
    try {
      makeDataDir(path.join(d, "new"));
      expect(fs.statSync(path.join(d, "new")).mode & 0o777).toBe(0o700);
      keyFromFile(path.join(d, "new2"));
      expect(fs.statSync(path.join(d, "new2")).mode & 0o777).toBe(0o700);
      fs.mkdirSync(path.join(d, "there"));
      fs.chmodSync(path.join(d, "there"), 0o755);
      makeDataDir(path.join(d, "there"));
      keyFromFile(path.join(d, "there"));
      expect(fs.statSync(path.join(d, "there")).mode & 0o777).toBe(0o755);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  it("a crash before the key is in place leaves no key file, and no temp file stays behind", () => {
    const d = scratch();
    const link = vi.spyOn(fs, "linkSync").mockImplementationOnce(() => { throw Object.assign(new Error("crash"), { code: "EIO" }); });
    try {
      expect(() => keyFromFile(d)).toThrow("crash");
      expect(fs.readdirSync(d)).toEqual([]);
      link.mockRestore();
      const key = keyFromFile(d);
      expect(key).toHaveLength(32);
      expect(fs.readdirSync(d)).toEqual(["app.key"]);
      expect(fs.statSync(path.join(d, "app.key")).mode & 0o777).toBe(0o600);
    } finally { link.mockRestore(); fs.rmSync(d, { recursive: true, force: true }); }
  });

  it("another start that gets there first keeps its key", () => {
    const d = scratch();
    const theirs = crypto.randomBytes(32);
    const real = fs.linkSync;
    const link = vi.spyOn(fs, "linkSync").mockImplementationOnce((from, to) => {
      fs.writeFileSync(to, theirs.toString("base64"), { mode: 0o600 });
      real(from, to);
    });
    try {
      expect(keyFromFile(d).equals(theirs)).toBe(true);
      expect(fs.readdirSync(d)).toEqual(["app.key"]);
    } finally { link.mockRestore(); fs.rmSync(d, { recursive: true, force: true }); }
  });
});
