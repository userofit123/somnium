// The recovery key (PLAN.md §4.1, §4.4): made on the device, kept on the server only as salt, wrapped key and a hashed
// verifier. Forgot password: the verifier is checked (counted like a sign-in try) before the wrapped key is handed over,
// names cannot be told apart, two-factor still applies, the key works once even under a race, every other session
// ends, and after an admin reset it brings the sealed journal back. The crypto runs through the real helpers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { pgliteDb } from "@somnium/engine/pglite";
import type { Db } from "@somnium/engine";
import {
  createAccountKeys, changePassword, addRecoveryKey, openWithRecoveryKey, openWithPassword, deriveRecoveryKeys,
  toBase64url, fromBase64url, sealColumn, unsealColumn, type RecoveryKeySet,
} from "@somnium/shared";
import { buildApp } from "../src/app";
import { totp, forgetFails } from "../src/auth";

let app: FastifyInstance, db: Db, dir: string;
let admin: { authKey: string };
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: "POST", url: "/api" + url, payload, headers });
const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url: "/api" + url, headers });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const signedIn = async (h: Record<string, string>) => (await get("/auth/sessions", h)).statusCode === 200;
const PW = "correct horse battery";

async function invite() { const code = "inv" + Math.random().toString(36).slice(2); await db.admin.query("INSERT INTO invites (code, expires_at) VALUES ($1, now() + interval '1 day')", [code]); return code; }
async function signUp(username: string, password = PW) {
  const keys = await createAccountKeys(password);
  const extra = admin ? { invite: await invite() } : {};
  const r = await post("/auth/sign-up", { username, authKey: keys.authKey, kdfSalt: keys.salt, wrappedByPassword: keys.wrappedByPassword, wantToken: true, ...extra });
  expect(r.statusCode).toBe(200);
  return { keys, h: bearer(r.json().token) };
}
const signIn = (username: string, authKey: string, extra: Record<string, unknown> = {}) => post("/auth/sign-in", { username, authKey, wantToken: true, ...extra });
/** Settings → Security: a recovery key from the open data key, sent with the password. */
async function makeKey(dataKey: Uint8Array, authKey: string, h: Record<string, string>): Promise<RecoveryKeySet> {
  const set = await addRecoveryKey(dataKey);
  const r = await post("/auth/recovery-key", { authKey, recoverySalt: set.recoverySalt, wrappedByRecovery: set.wrappedByRecovery, recoveryVerifier: set.recoveryVerifier }, h);
  expect(r.statusCode).toBe(200);
  return set;
}
/** What the device does with a typed key: the salt, the verifier, then the wrapped key and the data key. */
async function verifierFor(username: string, typed: string) {
  const { recoverySalt } = (await get(`/auth/recovery/salt?username=${username}`)).json();
  return toBase64url((await deriveRecoveryKeys(typed, fromBase64url(recoverySalt))).verifier);
}
async function finishBody(username: string, verifier: string, dataKey: Uint8Array, newPassword: string, extra: Record<string, unknown> = {}) {
  const pw = await changePassword(dataKey, newPassword);
  const next = await addRecoveryKey(dataKey);
  return { pw, next, body: { username, recoveryVerifier: verifier, authKey: pw.authKey, kdfSalt: pw.salt, wrappedByPassword: pw.wrappedByPassword, wantToken: true,
    next: { recoverySalt: next.recoverySalt, wrappedByRecovery: next.wrappedByRecovery, recoveryVerifier: next.recoveryVerifier }, ...extra } };
}
const randomVerifier = () => crypto.randomBytes(32).toString("base64url");
const notes = async (username: string): Promise<string[]> =>
  (await db.admin.query("SELECT text FROM account_events WHERE user_id = (SELECT id FROM users WHERE username = $1) ORDER BY at, id", [username])).rows.map((x: any) => x.text);

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "somnium-recovery-test-"));
  db = await pgliteDb("memory://");
  ({ app } = await buildApp({ db, dataDir: dir }));
  admin = (await signUp("boss")).keys;
}, 120000);
afterAll(async () => { await app.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => forgetFails());

describe("making the recovery key", () => {
  it("needs the password, keeps only a hash of the verifier, and replaces the old key", async () => {
    const { keys, h } = await signUp("maker");
    const set = await addRecoveryKey(keys.dataKey);
    const body = { recoverySalt: set.recoverySalt, wrappedByRecovery: set.wrappedByRecovery, recoveryVerifier: set.recoveryVerifier };
    expect((await post("/auth/recovery-key", body)).statusCode).toBe(401);
    expect((await post("/auth/recovery-key", { ...body, authKey: randomVerifier() }, h)).statusCode).toBe(403);
    expect((await post("/auth/recovery-key", { ...body, authKey: keys.authKey, recoveryVerifier: "short" }, h)).statusCode).toBe(400);
    expect((await post("/auth/recovery-key", { ...body, authKey: keys.authKey }, h)).statusCode).toBe(200);
    const row = (await db.admin.query("SELECT recovery_salt, wrapped_by_recovery, recovery_verifier, recovery_made_at FROM users WHERE username = 'maker'")).rows[0];
    expect(row.recovery_salt).toBe(set.recoverySalt);
    expect(row.recovery_verifier).toMatch(/^scrypt\$/);
    expect(row.recovery_verifier).not.toContain(set.recoveryVerifier);
    expect(row.recovery_made_at).not.toBeNull();
    expect((await get("/auth/security", h)).json().recoveryMadeAt).not.toBeNull();

    const second = await makeKey(keys.dataKey, keys.authKey, h);
    expect((await post("/auth/recovery/open", { username: "maker", recoveryVerifier: set.recoveryVerifier })).statusCode).toBe(403); // the old one is gone
    expect((await post("/auth/recovery/open", { username: "maker", recoveryVerifier: second.recoveryVerifier })).statusCode).toBe(200);
    expect(await notes("maker")).toEqual(expect.arrayContaining(["Recovery key made", "Recovery key replaced. The old one no longer works."]));
  }, 60000);
});

describe("forgot password with the recovery key", () => {
  it("checks the verifier before handing over the wrapped key, which opens the same data key", async () => {
    const { keys, h } = await signUp("vera");
    const set = await makeKey(keys.dataKey, keys.authKey, h);
    expect((await get("/auth/recovery/salt?username=vera")).json().recoverySalt).toBe(set.recoverySalt);
    const wrong = await post("/auth/recovery/open", { username: "vera", recoveryVerifier: randomVerifier() });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).not.toHaveProperty("wrappedByRecovery");
    // the typed key in another form (lower case, spaces) is the same key
    const typed = set.recoveryKey.toLowerCase().replace(/-/g, " ");
    const verifier = await verifierFor("vera", typed);
    const ok = await post("/auth/recovery/open", { username: "vera", recoveryVerifier: verifier });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ recoverySalt: set.recoverySalt, wrappedByRecovery: set.wrappedByRecovery, totpRequired: false });
    const opened = await openWithRecoveryKey(ok.json(), typed);
    expect(toBase64url(opened.dataKey)).toBe(toBase64url(keys.dataKey));
  }, 60000);

  it("answers the same for a wrong key, an unknown name and an account without a key", async () => {
    await signUp("nokey");
    const salts = async (n: string) => [(await get(`/auth/recovery/salt?username=${n}`)).json().recoverySalt, (await get(`/auth/recovery/salt?username=${n}`)).json().recoverySalt];
    for (const n of ["nobody-here", "nokey"]) {
      const [a, b] = await salts(n);
      expect(a).toBe(b); // the same stand-in every time
      expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(a).not.toBe((await get(`/auth/salt?username=${n}`)).json().kdfSalt); // not the sign-in stand-in either
    }
    const answers = await Promise.all(["nobody-here", "nokey", "vera"].map(async (n) => {
      forgetFails();
      const r = await post("/auth/recovery/open", { username: n, recoveryVerifier: randomVerifier() });
      return [r.statusCode, r.body];
    }));
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]![0]).toBe(403);
  }, 60000);

  it("counts wrong keys with the sign-in tries and makes them wait", async () => {
    const { keys, h } = await signUp("guess");
    const set = await makeKey(keys.dataKey, keys.authKey, h);
    for (let i = 0; i < 5; i++) expect((await post("/auth/recovery/open", { username: "guess", recoveryVerifier: randomVerifier() })).statusCode).toBe(403);
    expect((await post("/auth/recovery/open", { username: "guess", recoveryVerifier: set.recoveryVerifier })).statusCode).toBe(429); // even the right one waits
    expect((await signIn("guess", keys.authKey)).statusCode).toBe(429); // the same count as signing in
    const { body } = await finishBody("guess", set.recoveryVerifier, keys.dataKey, "a whole new password");
    expect((await post("/auth/recovery/finish", body)).statusCode).toBe(429);
    forgetFails();
    // a burst sent at once cannot all be checked: the tries are reserved before the slow hash
    const burst = await Promise.all(Array.from({ length: 8 }, () => post("/auth/recovery/open", { username: "guess", recoveryVerifier: randomVerifier() })));
    expect(burst.filter((r) => r.statusCode === 429).length).toBe(3);
  }, 60000);

  it("sets a new password, makes a new key, uses up the old one, ends every session and notes it", async () => {
    const { keys, h } = await signUp("rita");
    const set = await makeKey(keys.dataKey, keys.authKey, h);
    const other = bearer((await signIn("rita", keys.authKey)).json().token);
    const id = "0190f0e0-0000-7000-8000-000000000001";
    const sealedBefore = await sealColumn("I was flying over the sea", keys.dataKey, "dreams", "text", id);

    const opened = await openWithRecoveryKey((await post("/auth/recovery/open", { username: "rita", recoveryVerifier: await verifierFor("rita", set.recoveryKey) })).json(), set.recoveryKey);
    const { pw, next, body } = await finishBody("rita", opened.recoveryVerifier, opened.dataKey, "a whole new password");
    const done = await post("/auth/recovery/finish", body);
    expect(done.statusCode).toBe(200);
    const fresh = bearer(done.json().token);
    expect(await signedIn(fresh)).toBe(true);
    expect(await signedIn(h)).toBe(false);
    expect(await signedIn(other)).toBe(false);
    expect((await signIn("rita", keys.authKey)).statusCode).toBe(401);
    expect((await post("/auth/recovery/open", { username: "rita", recoveryVerifier: set.recoveryVerifier })).statusCode).toBe(403); // used up
    expect((await post("/auth/recovery/finish", body)).statusCode).toBe(403);
    // the new password and the new key both open the data key that sealed the old dream
    const back = (await signIn("rita", pw.authKey)).json();
    const byPassword = await openWithPassword({ salt: back.kdfSalt, wrappedByPassword: back.wrappedByPassword }, "a whole new password");
    expect(await unsealColumn(sealedBefore, byPassword, "dreams", "text", id)).toBe("I was flying over the sea");
    const byNewKey = await openWithRecoveryKey((await post("/auth/recovery/open", { username: "rita", recoveryVerifier: next.recoveryVerifier })).json(), next.recoveryKey);
    expect(await unsealColumn(sealedBefore, byNewKey.dataKey, "dreams", "text", id)).toBe("I was flying over the sea");
    expect(await notes("rita")).toContain("Password set with the recovery key. A new recovery key was made and every other device was signed out.");
  }, 90000);

  it("uses the key once when two requests race", async () => {
    const { keys, h } = await signUp("race");
    const set = await makeKey(keys.dataKey, keys.authKey, h);
    const a = await finishBody("race", set.recoveryVerifier, keys.dataKey, "password number one");
    const b = await finishBody("race", set.recoveryVerifier, keys.dataKey, "password number two");
    const [ra, rb] = await Promise.all([post("/auth/recovery/finish", a.body), post("/auth/recovery/finish", b.body)]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 403]);
    const winner = ra.statusCode === 200 ? a : b, loser = ra.statusCode === 200 ? b : a;
    expect((await signIn("race", winner.pw.authKey)).statusCode).toBe(200);
    expect((await signIn("race", loser.pw.authKey)).statusCode).toBe(401);
    // the stored key is the winner's new one, whole: never a mix of the two
    const row = (await db.admin.query("SELECT recovery_salt, wrapped_by_recovery FROM users WHERE username = 'race'")).rows[0];
    expect(row).toEqual({ recovery_salt: winner.next.recoverySalt, wrapped_by_recovery: winner.next.wrappedByRecovery });
  }, 90000);

  it("asks for the authenticator or a backup code when two-factor is on", async () => {
    const { keys, h } = await signUp("twofa");
    const { secret } = (await post("/auth/2fa/start", { authKey: keys.authKey }, h)).json();
    const codes: string[] = (await post("/auth/2fa/enable", { code: totp(secret) }, h)).json().backupCodes;
    const set = await makeKey(keys.dataKey, keys.authKey, h);
    expect((await post("/auth/recovery/open", { username: "twofa", recoveryVerifier: set.recoveryVerifier })).json().totpRequired).toBe(true);
    const first = await finishBody("twofa", set.recoveryVerifier, keys.dataKey, "a whole new password");
    const none = await post("/auth/recovery/finish", first.body);
    expect(none.statusCode).toBe(403);
    expect(none.json().totpRequired).toBe(true);
    expect((await post("/auth/recovery/finish", { ...first.body, code: "000000" })).statusCode).toBe(403);
    expect((await signIn("twofa", keys.authKey, { code: codes[1] })).statusCode).toBe(200); // nothing changed yet
    const ok = await post("/auth/recovery/finish", { ...first.body, code: codes[0] });
    expect(ok.statusCode).toBe(200);
    expect((await signIn("twofa", first.pw.authKey)).json().totpRequired).toBe(true); // two-factor stays on
  }, 90000);
});

describe("the sealed journal after an admin reset", () => {
  it("opens again with the recovery key on the lock screen, keeping that session", async () => {
    const { keys, h } = await signUp("sealy");
    const set = await makeKey(keys.dataKey, keys.authKey, h);
    const id = "0190f0e0-0000-7000-8000-000000000002";
    const sealedBefore = await sealColumn("A lucid dream in the library", keys.dataKey, "dreams", "text", id);
    const bossH = bearer((await signIn("boss", admin.authKey)).json().token);
    const uid = (await db.admin.query("SELECT id FROM users WHERE username = 'sealy'")).rows[0].id;
    const code = (await app.inject({ method: "PUT", url: `/api/admin/users/${uid}`, headers: bossH, payload: { resetPassword: true } })).json().resetCode;
    const reset = await createAccountKeys("the password after reset");
    const r = await post("/auth/reset", { username: "sealy", code, authKey: reset.authKey, kdfSalt: reset.salt });
    expect(r.json().message).toBe("Your password is set. Your journal stays sealed until you enter your recovery key.");
    expect(await signedIn(h)).toBe(false); // the reset signed every device out: none can open it
    const after = (await signIn("sealy", reset.authKey)).json();
    expect(after.wrappedByPassword).toBeNull();
    const lockH = bearer(after.token);
    expect((await get("/auth/security", lockH)).json().sealed).toBe(true);

    // the lock screen: the key opens the data key, the password typed with it re-wraps it
    const opened = await openWithRecoveryKey((await post("/auth/recovery/open", { username: "sealy", recoveryVerifier: await verifierFor("sealy", set.recoveryKey) })).json(), set.recoveryKey);
    // a typo in "Your password" is refused, not stored as the new sign-in password; the recovery key still works after
    const typo = await finishBody("sealy", opened.recoveryVerifier, opened.dataKey, "the pasword after reset", { current: (await createAccountKeys("the pasword after reset")).authKey });
    const wrong = await post("/auth/recovery/finish", typo.body, lockH);
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe("Wrong password");
    const missing = await post("/auth/recovery/finish", (await finishBody("sealy", opened.recoveryVerifier, opened.dataKey, "the password after reset")).body, lockH);
    expect(missing.statusCode).toBe(403);
    expect((await get("/auth/security", lockH)).json().sealed).toBe(true);
    expect((await signIn("sealy", typo.pw.authKey)).statusCode).not.toBe(200);
    forgetFails();
    const { pw, body } = await finishBody("sealy", opened.recoveryVerifier, opened.dataKey, "the password after reset", { current: reset.authKey });
    const done = await post("/auth/recovery/finish", body, lockH);
    expect(done.statusCode).toBe(200);
    expect(done.json().token).toBeUndefined(); // the session asking keeps going
    expect(await signedIn(lockH)).toBe(true);
    const bundle = (await get("/auth/bundle", lockH)).json();
    expect(bundle.wrappedByPassword).toBe(pw.wrappedByPassword);
    expect((await get("/auth/security", lockH)).json().sealed).toBe(false);
    const dataKey = await openWithPassword({ salt: bundle.kdfSalt, wrappedByPassword: bundle.wrappedByPassword }, "the password after reset");
    expect(await unsealColumn(sealedBefore, dataKey, "dreams", "text", id)).toBe("A lucid dream in the library");
    expect(await notes("sealy")).toContain("Journal opened again with the recovery key after a password reset. A new recovery key was made.");
  }, 90000);
});
