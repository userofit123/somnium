// Sign-in with the auth key (PLAN.md §4.1-4.2): the server only ever sees authKey, checks it, and hands back the
// salt and the wrapped data key; two-factor sign-in with an authenticator code or a one-time backup code; a
// password change signs the other devices out; too many wrong tries wait.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { pgliteDb } from "@somnium/engine/pglite";
import type { Db } from "@somnium/engine";
import { createAccountKeys, changePassword, openWithPassword, toBase64url, fromBase64url } from "@somnium/shared";
import { buildApp } from "../src/app";
import { totp, forgetFails, decryptForServer, loadServerKey } from "../src/auth";

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
beforeEach(() => forgetFails());

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

async function invite() { const code = "inv" + Math.random().toString(36).slice(2); await db.admin.query("INSERT INTO invites (code, expires_at) VALUES ($1, now() + interval '1 day')", [code]); return code; }

describe("two-factor sign-in", () => {
  it("asks for a code once enabled, takes an authenticator code or a backup code once, and turns off with a code", async () => {
    const { keys, h } = await signUp("two", "correct horse battery", { invite: await invite() });
    const start = (await post("/auth/2fa/start", {}, h)).json();
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
    const withTotp = await signIn("two", keys.authKey, { totp: totp(start.secret) });
    expect(withTotp.statusCode).toBe(200);
    expect(withTotp.json().wrappedByPassword).toBe(keys.wrappedByPassword);
    const withBackup = await signIn("two", keys.authKey, { code: codes[0]!.toLowerCase() });
    expect(withBackup.statusCode).toBe(200);
    expect((await signIn("two", keys.authKey, { code: codes[0] })).statusCode).toBe(401); // used up
    expect((await app.inject({ method: "GET", url: "/api/auth/security", headers: h })).json()).toMatchObject({ totpEnabled: true, backupCodesLeft: 7 });

    expect((await post("/auth/2fa/disable", { authKey: keys.authKey, code: "000000" }, h)).statusCode).toBe(403);
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
    expect((await post("/auth/reset", { username: "lost", code, authKey: fresh.authKey, kdfSalt: fresh.salt })).statusCode).toBe(200);
    expect((await post("/auth/reset", { username: "lost", code, authKey: fresh.authKey, kdfSalt: fresh.salt })).statusCode).toBe(403); // one-time
    expect((await signIn("lost", keys.authKey)).statusCode).toBe(401);
    const r = await signIn("lost", fresh.authKey);
    expect(r.statusCode).toBe(200);
    expect(r.json().wrappedByPassword).toBeNull();
  });
});
