// The crypto test of PLAN.md §4.5: wrap/unwrap by password, recovery key and device key, password change, the
// recovery flow, and the sealing of values. Argon2id (64 MiB, 3 passes) takes well under a second per run; the
// shared account below keeps the number of runs small.
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  addRecoveryKey, changePassword, constantTimeEqual, createAccountKeys, deriveKeys, formatRecoveryKey, fromBase64url,
  isSealed, newDataKey, newRecoveryKey, newSalt, openWithDevice, openWithEncKey, openWithPassword, openWithRecoveryKey, plainRecoveryKey,
  randomBytes, sealBytes, sealColumn, sealText, unsealColumn, SealError, toBase64url, unsealBytes, unsealText, unwrapKey, wrapForDevice, wrapKey,
  type AccountKeys, type RecoveryKeySet, RECOVERY_KEY_CHARS,
} from "./index";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const PASSWORD = "correct horse battery staple ✨";
let account: AccountKeys;

beforeAll(async () => { account = await createAccountKeys(PASSWORD); });

describe("key derivation", () => {
  it("is deterministic for one salt, differs by salt, and keeps encKey and authKey apart", async () => {
    const salt = newSalt();
    const t0 = performance.now();
    const a = await deriveKeys("pw", salt);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(10_000); // lenient: slow CI machines
    const b = await deriveKeys("pw", salt);
    const c = await deriveKeys("pw", newSalt());
    expect(toBase64url(a.encKey)).toBe(toBase64url(b.encKey));
    expect(toBase64url(a.authKey)).toBe(toBase64url(b.authKey));
    expect(toBase64url(a.encKey)).not.toBe(toBase64url(c.encKey));
    expect(toBase64url(a.authKey)).not.toBe(toBase64url(c.authKey));
    expect(toBase64url(a.encKey)).not.toBe(toBase64url(a.authKey));
    expect(a.encKey.length).toBe(32);
    expect(a.authKey.length).toBe(32);
    expect(salt.length).toBe(16);
  });
});

describe("wrapping the data key", () => {
  it("round-trips and gives a versioned envelope", async () => {
    const dataKey = newDataKey(), kek = randomBytes(32);
    const wrapped = await wrapKey(dataKey, kek);
    expect(isSealed(wrapped)).toBe(true);
    expect(wrapped.startsWith("v1.")).toBe(true);
    expect(toBase64url(await unwrapKey(wrapped, kek))).toBe(toBase64url(dataKey));
    // a fresh iv each time: the same key wrapped twice looks different
    expect(await wrapKey(dataKey, kek)).not.toBe(wrapped);
  });
  it("refuses a wrong key and a tampered byte", async () => {
    const dataKey = newDataKey(), kek = randomBytes(32);
    const wrapped = await wrapKey(dataKey, kek);
    await expect(unwrapKey(wrapped, randomBytes(32))).rejects.toBeInstanceOf(SealError);
    const [v, iv, ct] = wrapped.split(".") as [string, string, string];
    const bytes = fromBase64url(ct);
    bytes[0] = (bytes[0]! ^ 0x01);
    await expect(unwrapKey(`${v}.${iv}.${toBase64url(bytes)}`, kek)).rejects.toBeInstanceOf(SealError);
  });
});

describe("the account's password", () => {
  it("opens with the right password and not with a wrong one", async () => {
    expect(account.salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(account.authKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const opened = await openWithPassword(account, PASSWORD);
    expect(toBase64url(opened)).toBe(toBase64url(account.dataKey));
    await expect(openWithPassword(account, PASSWORD + "!")).rejects.toBeInstanceOf(SealError);
  });
  it("opens with a pre-derived encKey (no second Argon2id at sign-in)", async () => {
    const { encKey, authKey } = await deriveKeys(PASSWORD, fromBase64url(account.salt));
    expect(toBase64url(authKey)).toBe(account.authKey);
    expect(toBase64url(await openWithEncKey(account, encKey))).toBe(toBase64url(account.dataKey));
  });
  it("changes the password by re-wrapping: same data key, new authKey, old password no longer opens", async () => {
    const changed = await changePassword(account.dataKey, "a new password");
    expect(changed.authKey).not.toBe(account.authKey);
    expect(changed.salt).not.toBe(account.salt);
    expect(toBase64url(await openWithPassword(changed, "a new password"))).toBe(toBase64url(account.dataKey));
    await expect(openWithPassword(changed, PASSWORD)).rejects.toBeInstanceOf(SealError);
    // a value sealed with the data key still opens with the key from the new password: the data key did not change
    const sealed = await sealText("sealed with the data key", account.dataKey);
    expect(await unsealText(sealed, await openWithPassword(changed, "a new password"))).toBe("sealed with the data key");
  });
});

describe("domain separation and edge cases", () => {
  it("a wrapped key cannot be opened as a sealed value (different aad)", async () => {
    const kek = randomBytes(32);
    const wrapped = await wrapKey(newDataKey(), kek);
    await expect(unsealBytes(wrapped, kek)).rejects.toBeInstanceOf(SealError);
    await expect(unsealText(wrapped, kek, "dreams.text.1")).rejects.toBeInstanceOf(SealError);
  });
  it("NFC and NFD forms of one password give the same keys", async () => {
    const salt = newSalt();
    const a = await deriveKeys("caf\u00e9", salt), b = await deriveKeys("cafe\u0301", salt);
    expect(toBase64url(a.encKey)).toBe(toBase64url(b.encKey));
    expect(toBase64url(a.authKey)).toBe(toBase64url(b.authKey));
  });
  it("a malformed base64 envelope rejects with SealError", async () => {
    const key = randomBytes(32);
    // 17 chars is not valid base64url (1 mod 4) but matches the envelope pattern's length bounds
    await expect(unsealText("v1.AAAAAAAAAAAAAAAA." + "A".repeat(25), key)).rejects.toBeInstanceOf(SealError);
    await expect(unsealText("v1." + "A".repeat(17) + "." + "A".repeat(24), key)).rejects.toBeInstanceOf(SealError);
  });
  it("column helpers bind the aad to table, column and row", async () => {
    const key = randomBytes(32);
    const sealed = await sealColumn("a dream", key, "dreams", "text", "row-1");
    expect(await unsealColumn(sealed, key, "dreams", "text", "row-1")).toBe("a dream");
    await expect(unsealColumn(sealed, key, "dreams", "text", "row-2")).rejects.toBeInstanceOf(SealError);
    await expect(unsealColumn(sealed, key, "dreams", "title", "row-1")).rejects.toBeInstanceOf(SealError);
  });
  it("a malformed typed recovery key fails early with SealError", async () => {
    const bundle = { recoverySalt: toBase64url(newSalt()), wrappedByRecovery: "v1." + "A".repeat(16) + "." + "A".repeat(40) };
    await expect(openWithRecoveryKey(bundle, "ABCD-EFGH")).rejects.toThrow("That recovery key does not look right");
    await expect(openWithRecoveryKey(bundle, "0000-0000-0000-0000-0000")).rejects.toBeInstanceOf(SealError);
  });
});

describe("the recovery key", () => {
  let rec: RecoveryKeySet;
  beforeAll(async () => { rec = await addRecoveryKey(account.dataKey); });

  it("has Money Manager's format: 5 groups of 4 from 31 unambiguous characters", () => {
    expect(rec.recoveryKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
    for (const ch of plainRecoveryKey(rec.recoveryKey)) expect(RECOVERY_KEY_CHARS).toContain(ch);
    expect(newRecoveryKey()).not.toBe(newRecoveryKey());
    expect(formatRecoveryKey("abcdefghjkmnpqrstuvw")).toBe("ABCD-EFGH-JKMN-PQRS-TUVW");
    expect(plainRecoveryKey(" ab cd-EF\tgh ")).toBe("ABCDEFGH");
  });
  it("opens the data key from a typed key in any form, and gives the verifier", async () => {
    const typed = rec.recoveryKey.toLowerCase().replace(/-/g, " ");
    const { dataKey, recoveryVerifier } = await openWithRecoveryKey(rec, typed);
    expect(toBase64url(dataKey)).toBe(toBase64url(account.dataKey));
    expect(recoveryVerifier).toBe(rec.recoveryVerifier);
    expect(constantTimeEqual(fromBase64url(recoveryVerifier), fromBase64url(rec.recoveryVerifier))).toBe(true);
    // the verifier is not the kek: it cannot unwrap
    await expect(unwrapKey(rec.wrappedByRecovery, fromBase64url(rec.recoveryVerifier))).rejects.toBeInstanceOf(SealError);
  });
  it("refuses a wrong key", async () => {
    const wrong = rec.recoveryKey.endsWith("A") ? rec.recoveryKey.slice(0, -1) + "B" : rec.recoveryKey.slice(0, -1) + "A";
    await expect(openWithRecoveryKey(rec, wrong)).rejects.toBeInstanceOf(SealError);
  });
});

describe("this device", () => {
  it("wraps for a device key and opens with it", async () => {
    const deviceKek = randomBytes(32);
    const wrapped = await wrapForDevice(account.dataKey, deviceKek);
    expect(isSealed(wrapped)).toBe(true);
    expect(toBase64url(await openWithDevice(wrapped, deviceKek))).toBe(toBase64url(account.dataKey));
    await expect(openWithDevice(wrapped, randomBytes(32))).rejects.toBeInstanceOf(SealError);
  });
});

describe("sealing values", () => {
  const key = newDataKey();
  it("round-trips text with unicode and the empty string", async () => {
    for (const text of ["", "I was flying over the sea 🌊 — ואז התעוררתי", "plain ascii"]) {
      const sealed = await sealText(text, key);
      expect(isSealed(sealed)).toBe(true);
      expect(sealed).not.toContain("flying");
      expect(await unsealText(sealed, key)).toBe(text);
    }
  });
  it("round-trips bytes", async () => {
    const blob = randomBytes(5000);
    expect(toBase64url(await unsealBytes(await sealBytes(blob, key), key))).toBe(toBase64url(blob));
  });
  it("binds a value to its field with aad", async () => {
    const sealed = await sealText("a note", key, "dreams.text.0192-row");
    expect(await unsealText(sealed, key, "dreams.text.0192-row")).toBe("a note");
    await expect(unsealText(sealed, key, "dreams.title.0192-row")).rejects.toBeInstanceOf(SealError);
    await expect(unsealText(sealed, key)).rejects.toBeInstanceOf(SealError);
  });
  it("refuses a wrong key, a tampered byte and a non-envelope string", async () => {
    const sealed = await sealText("secret", key);
    await expect(unsealText(sealed, newDataKey())).rejects.toBeInstanceOf(SealError);
    const [v, iv, ct] = sealed.split(".") as [string, string, string];
    const bytes = fromBase64url(ct);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! ^ 0x80);
    await expect(unsealText(`${v}.${iv}.${toBase64url(bytes)}`, key)).rejects.toBeInstanceOf(SealError);
    await expect(unsealText("just a dream", key)).rejects.toBeInstanceOf(SealError);
    await expect(unsealText("", key)).rejects.toBeInstanceOf(SealError);
  });
  it("tells envelopes from other strings", async () => {
    expect(isSealed(await sealText("x", key))).toBe(true);
    expect(isSealed("v1.short.short")).toBe(false);
    expect(isSealed("v2.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
    expect(isSealed(42)).toBe(false);
    expect(isSealed(null)).toBe(false);
    expect(isSealed("2026-11-06")).toBe(false);
  });
  it("compares bytes in constant time", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
