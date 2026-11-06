// A local account's database at rest (LDJ-53, PLAN.md §4.1): the app seals every sealed column before it reaches the
// engine and opens the answers (the same path a server account takes without a device copy), and the engine runs with
// the server's rule that a sealed column only ever takes ciphertext. A copy of the database folder holds no dream text.
// Accounts made before passwords held plaintext: they are sealed in place once a password is set.
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newDataKey } from "@somnium/shared";
import { createEngine, sealRequest, openResponse, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";

type Rec = Record<string, any>;
const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "somnium-local-")); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** Every byte of every file in the database folder, as one string to search. */
function folderBytes(dir: string): string {
  let out = "";
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    out += e.isDirectory() ? folderBytes(p) : fs.readFileSync(p).toString("latin1");
  }
  return out;
}

/** What the app does on a local account: seal on the way in, open on the way out (apps/web/src/api/client.ts). */
function client(e: Engine, userId: string, key: Uint8Array) {
  const raw = async (method: string, p: string, body?: unknown) => {
    const [pth, qs] = p.split("?");
    const r = await e.handle({ method, path: pth!, body, query: Object.fromEntries(new URLSearchParams(qs ?? "")), userId });
    if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
    return r.body as any;
  };
  return async (method: string, p: string, body?: unknown): Promise<Rec> => {
    const out = await sealRequest(method, p, body, key, (q) => raw("GET", q));
    return (await openResponse(p, await raw(method, p, method === "GET" ? undefined : out), key)).data as Rec;
  };
}

const SECRET = { text: "ATREST-TEXT-glass-orchard-5301", title: "ATREST-TITLE-5302", notes: "ATREST-NOTES-5303", name: "ATREST-ELEMENT-5304" };

describe("a local account at rest", () => {
  it("keeps no plaintext in its database files, and reads back through the app", async () => {
    const dir = tmp(), key = newDataKey();
    const db = await pgliteDb(dir);
    const e = await createEngine(db, { mode: "server" });
    const userId = await e.ensureLocalUser("Me");
    const call = client(e, userId, key);
    const night = await call("POST", "/nights", { date: "2026-11-05", notes: SECRET.notes });
    const dream = await call("POST", "/dreams", { nightId: night.id, title: SECRET.title, text: SECRET.text, lucid: true });
    await call("POST", "/elements", { kind: "place", name: SECRET.name });
    expect((await call("GET", `/dreams/${dream.id}`)).text).toBe(SECRET.text);
    expect((await call("GET", "/nights"))[0]!.notes).toBe(SECRET.notes);
    // the engine refuses a sealed column in the clear, so no screen can write one by mistake
    expect((await e.handle({ method: "POST", path: "/elements", body: { kind: "place", name: "PLAIN-5309" }, userId })).status).toBe(400);
    // a backup from it is the same form a server account's is: plaintext once opened, sealed again on the way in
    const backup = await call("GET", "/export");
    expect(backup.sealed).toBe(false);
    expect(JSON.stringify(backup)).toContain(SECRET.text);
    await db.admin.exec("CHECKPOINT");
    await db.close();
    const bytes = folderBytes(dir);
    expect(bytes.length).toBeGreaterThan(1_000_000);
    for (const s of Object.values(SECRET)) expect(bytes).not.toContain(s);
  }, 120000);

  it("seals an account made before passwords in place, losing nothing", async () => {
    const dir = tmp(), key = newDataKey();
    // before: the engine took plaintext
    let db = await pgliteDb(dir);
    let e = await createEngine(db, { mode: "local" });
    const userId = await e.ensureLocalUser("Me");
    const night = (await e.handle({ method: "POST", path: "/nights", body: { date: "2026-10-01", notes: SECRET.notes }, userId })).body as Rec;
    const dream = (await e.handle({ method: "POST", path: "/dreams", body: { nightId: night.id, title: SECRET.title, text: SECRET.text }, userId })).body as Rec;
    await db.close();
    expect(folderBytes(dir)).toContain(SECRET.text);

    // after: the password is set, and the app seals what is there (apps/web/src/core/localLock.ts)
    db = await pgliteDb(dir);
    e = await createEngine(db, { mode: "server" });
    const call = client(e, userId, key);
    // older plaintext still reads, so nothing is lost before or during the sealing
    expect((await call("GET", `/dreams/${dream.id}`)).text).toBe(SECRET.text);
    const data = await call("GET", "/export");
    await call("POST", "/import", { data, mode: "replace" });
    const raw = (await db.admin.query<Rec>("SELECT text, title FROM dreams")).rows[0]!;
    expect(raw.text).not.toContain(SECRET.text);
    expect((await call("GET", `/dreams/${dream.id}`)).text).toBe(SECRET.text);
    expect((await call("GET", `/dreams/${dream.id}`)).title).toBe(SECRET.title);
    expect((await call("GET", "/nights"))[0]!.notes).toBe(SECRET.notes);
    // the replaced rows' old versions (in the tables and the write-ahead log) are cleared out of the files, as the app does after sealing
    await e.compact();
    await db.close();
    const bytes = folderBytes(dir);
    expect(bytes).not.toContain(SECRET.title);
    expect(bytes).not.toContain(SECRET.notes);
    expect(bytes).not.toContain(SECRET.text);
  }, 120000);
});
