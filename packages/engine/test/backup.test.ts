// LDJ-35: the .somniumbackup file (made, opened with the password, with the recovery key, refused with a wrong one,
// wrapped with a passphrase) and the restore's merge (add what's missing, newest wins) and replace semantics.
import { describe, it, expect, beforeAll } from "vitest";
import { addRecoveryKey, createAccountKeys, isSealed } from "@somnium/shared";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { lockBackupFile, makeBackupFile, openBackupKey, openExport, parseBackupFile, unlockBackupFile, type BackupFile } from "../src/sync/backupFile";
import { previewImport } from "../src/sync/sealedApi";

let eng: Engine;
let A: string;
const call = async <T = any>(method: string, path: string, body?: unknown, query?: Record<string, string>, user = A): Promise<T> => {
  const r = await eng.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as T;
};

const PASSWORD = "correct horse battery 9";
let keys: Awaited<ReturnType<typeof createAccountKeys>>;
let recovery: Awaited<ReturnType<typeof addRecoveryKey>>;
let file: BackupFile;
let plain: any;

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "local" });
  A = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A')", [A]);
  keys = await createAccountKeys(PASSWORD);
  recovery = await addRecoveryKey(keys.dataKey);
  const night = await call("POST", "/nights", { date: "2026-11-01", sleepQuality: 4, notes: "slept well" });
  await call("POST", "/dreams", { nightId: night.id, title: "Flying", text: "Over the harbour at dawn", lucid: true, lucidityLevel: 3 });
  const n2 = await call("POST", "/nights", { date: "2026-11-03" });
  await call("POST", "/dreams", { nightId: n2.id, title: "Exam", text: "The school again" });
  await call("POST", "/reality-checks", { kind: "nose", outcome: "awake", note: "on the bus" });
  plain = await call("GET", "/export");
  file = await makeBackupFile(plain, keys.dataKey, { kdfSalt: keys.salt, wrappedByPassword: keys.wrappedByPassword, recoverySalt: recovery.recoverySalt, wrappedByRecovery: recovery.wrappedByRecovery });
}, 120000);

describe("the backup file", () => {
  it("holds the journal sealed and the plain columns readable", () => {
    const text = JSON.stringify(file);
    expect(text).not.toContain("harbour");
    expect(text).not.toContain("slept well");
    expect(text).not.toContain("on the bus");
    expect(file.format).toBe("somnium-backup");
    expect(file.data.sealed).toBe(true);
    const d = file.data.tables.dreams.find((x: any) => x.lucid);
    expect(isSealed(d.text)).toBe(true);
    expect(isSealed(d.title)).toBe(true);
    expect(d.lucidity_level).toBe(3);
    const pv = previewImport({ data: file.data })!;
    expect(pv.counts.dreams).toBe(2);
    expect([pv.from, pv.to]).toEqual(["2026-11-01", "2026-11-03"]);
  });

  it("opens with the password", async () => {
    const back = parseBackupFile(JSON.stringify(file)) as BackupFile;
    const key = await openBackupKey(back, PASSWORD);
    const { data, unopened } = await openExport(back.data, key);
    expect(unopened).toBe(0);
    expect(data.tables.dreams.map((d: any) => d.text).sort()).toEqual(["Over the harbour at dawn", "The school again"]);
    expect(data.tables.reality_checks[0].note).toBe("on the bus");
  }, 60000);

  it("opens with the recovery key, in any case and with spaces", async () => {
    const typed = recovery.recoveryKey.toLowerCase().replace(/-/g, " ");
    const key = await openBackupKey(file, typed);
    expect(Buffer.from(key).equals(Buffer.from(keys.dataKey))).toBe(true);
  }, 60000);

  it("refuses a wrong password and a wrong recovery key", async () => {
    await expect(openBackupKey(file, "not the password")).rejects.toThrow(/doesn't open/);
    await expect(openBackupKey(file, "ABCD-EFGH-JKMN-PQRS-TUVW")).rejects.toThrow(/doesn't open/);
  }, 60000);

  it("can be wrapped with a passphrase that hides the dates too", async () => {
    const locked = await lockBackupFile(file, "a long extra passphrase");
    const text = JSON.stringify(locked);
    expect(text).not.toContain("2026-11-01");
    expect(parseBackupFile(text).format).toBe("somnium-backup-locked");
    await expect(unlockBackupFile(locked, "wrong")).rejects.toThrow();
    const inner = await unlockBackupFile(locked, "a long extra passphrase");
    expect(inner.data.tables.dreams).toHaveLength(2);
  }, 60000);

  it("refuses what isn't a backup", () => {
    expect(() => parseBackupFile("{\"hello\":1}")).toThrow(/not a Somnium backup/);
    expect(() => parseBackupFile("not json")).toThrow(/not a Somnium backup/);
  });
});

describe("restoring", () => {
  it("merges: adds what's missing, and the newest version of a row wins", async () => {
    const { data } = await openExport(file.data, keys.dataKey);
    const flying = data.tables.dreams.find((d: any) => d.lucid);
    const exam = data.tables.dreams.find((d: any) => !d.lucid);
    // here: Flying edited after the backup, Exam removed for good, a new night with a dream
    await call("PUT", `/dreams/${flying.id}`, { text: "Edited later" });
    await eng.db.admin.query("DELETE FROM dreams WHERE id = $1", [exam.id]);
    // the file: Exam's copy is old, and a copy of Flying edited "before" the edit here
    const older = { ...data, tables: { ...data.tables, dreams: data.tables.dreams.map((d: any) => (d.id === flying.id ? { ...d, text: "Stale", updated_at: "2000-01-01T00:00:00Z" } : d)) } };
    await call("POST", "/import", { data: older, mode: "merge" });
    const dreams = await call<any[]>("GET", "/dreams");
    expect(dreams.find((d) => d.id === flying.id).text).toBe("Edited later");
    expect(dreams.find((d) => d.id === exam.id)?.text).toBe("The school again");
    // and a newer copy in the file wins
    const newer = { ...data, tables: { ...data.tables, dreams: data.tables.dreams.map((d: any) => (d.id === flying.id ? { ...d, text: "From the file", updated_at: "2999-01-01T00:00:00Z" } : d)) } };
    await call("POST", "/import", { data: newer, mode: "merge" });
    expect((await call("GET", `/dreams/${flying.id}`)).text).toBe("From the file");
  });

  it("merges a night of a date this account already has into that night", async () => {
    const other = { app: "somnium", format: 1, tables: { nights: [{ id: uuidv7(), date: "2026-11-01", nap: false }], dreams: [] as any[] } };
    other.tables.dreams.push({ id: uuidv7(), night_id: other.tables.nights[0]!.id, title: "Other device", text: "x" });
    await call("POST", "/import", { data: other, mode: "merge" });
    const nights = await call<any[]>("GET", "/nights", undefined, { from: "2026-11-01", to: "2026-11-01" });
    expect(nights).toHaveLength(1);
    expect(nights[0].dreamCount).toBe(2);
  });

  it("replaces: the journal becomes the file's, the account stays", async () => {
    await call("POST", "/nights", { date: "2026-11-05" });
    const { data } = await openExport(file.data, keys.dataKey);
    await call("POST", "/import", { data, mode: "replace" });
    const nights = await call<any[]>("GET", "/nights");
    expect(nights.map((n) => n.date).sort()).toEqual(["2026-11-01", "2026-11-03"]);
    expect((await call<any[]>("GET", "/dreams")).map((d) => d.text).sort()).toEqual(["Over the harbour at dawn", "The school again"]);
    expect((await eng.db.admin.query("SELECT username FROM users WHERE id = $1", [A])).rows[0].username).toBe("a");
  });
});
