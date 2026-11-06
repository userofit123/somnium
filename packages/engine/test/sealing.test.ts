// The sealed journal (PLAN.md §4.1, §4.5): sealed columns are ciphertext on the server, bound to their row and
// column, and the server never holds plaintext from a dream written through a device.
import { describe, it, expect, beforeAll } from "vitest";
import { newDataKey, isSealed, SealError, toBase64url, randomBytes } from "@somnium/shared";
import { createEngine, replica, SEALED_COLUMNS, SEALED_TABLES, sealRows, unsealRows, LockedError, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { SYNCED } from "../src/sync/tables";
import { uuidv7 } from "../src/ids";

const KEY = newDataKey(), OTHER_KEY = newDataKey();

describe("sealRows / unsealRows", () => {
  it("round-trips every sealed column of every sealed table and leaves the plain ones alone", async () => {
    for (const table of SEALED_TABLES) {
      const row: Record<string, unknown> = { id: uuidv7(), user_id: "u", lucid: true, position: 3, deleted_at: null };
      for (const c of SEALED_COLUMNS[table]!) row[c] = table === "media" && c === "data" ? toBase64url(randomBytes(300)) : `secret ${table} ${c} ü ✓`;
      const [sealed] = await sealRows(table, [row], KEY);
      for (const c of SEALED_COLUMNS[table]!) {
        expect(sealed![c]).not.toBe(row[c]);
        expect(isSealed(sealed![c])).toBe(true);
      }
      expect(sealed!.lucid).toBe(true);
      expect(sealed!.position).toBe(3);
      const [back] = await unsealRows(table, [sealed!], KEY);
      expect(back).toEqual(row);
    }
  });

  it("keeps nulls, passes plain tables through, and does not seal twice", async () => {
    const [n] = await sealRows("dreams", [{ id: uuidv7(), title: null, text: "x" }], KEY);
    expect(n!.title).toBeNull();
    const goal = { id: uuidv7(), kind: "journal_streak", target: 3 };
    expect(await sealRows("goals", [goal], null)).toEqual([goal]);
    expect(await unsealRows("goals", [goal], null)).toEqual([goal]);
    // a value already in envelope form (a file sealed before upload) travels as it is
    const [again] = await sealRows("dreams", [n!], KEY);
    expect(again!.text).toBe(n!.text);
  });

  it("binds a value to its row, column and key", async () => {
    const a = uuidv7(), b = uuidv7();
    const [sealed] = await sealRows("dreams", [{ id: a, text: "mine" }], KEY);
    // moved to another row
    await expect(unsealRows("dreams", [{ id: b, text: sealed!.text }], KEY)).rejects.toBeInstanceOf(SealError);
    // moved to another column of the same row
    await expect(unsealRows("dreams", [{ id: a, title: sealed!.text }], KEY)).rejects.toBeInstanceOf(SealError);
    // moved to another table
    await expect(unsealRows("nights", [{ id: a, notes: sealed!.text }], KEY)).rejects.toBeInstanceOf(SealError);
    // another account's key
    await expect(unsealRows("dreams", [sealed!], OTHER_KEY)).rejects.toBeInstanceOf(SealError);
    // in its place, it opens
    expect((await unsealRows("dreams", [sealed!], KEY))[0]!.text).toBe("mine");
  });

  it("refuses a sealed table without a key, before touching anything", async () => {
    await expect(sealRows("dreams", [{ id: uuidv7(), text: "x" }], null)).rejects.toBeInstanceOf(LockedError);
    await expect(unsealRows("dreams", [{ id: uuidv7(), text: "x" }], undefined)).rejects.toBeInstanceOf(LockedError);
    expect(await sealRows("dreams", [], null)).toEqual([]);
  });
});

// The sealing test from PLAN.md §4.5: a server, a device that writes, a second device that reads.
describe("the server holds no plaintext", () => {
  let server: Engine, device: Engine, second: Engine, U: string, deviceId = "", secondId = "";
  const SECRETS = {
    nightNotes: "NIGHT-NOTES-saffron-lantern-4471",
    intention: "INTENTION-ask-the-river-9012",
    substances: "SUBSTANCES-chamomile-7730",
    title: "TITLE-violet-whale-8812",
    text: "TEXT-the lighthouse spoke in riddles about a clocktower 9931",
    trigger: "TRIGGER-my fingers counted eleven 2210",
    element: "ELEMENT-grandmother-in-the-orchard-5520",
    aliases: "ALIASES-grandma, nana 5521",
    elementNote: "ELEMENTNOTE-always-by-the-well-5522",
    span: "SPAN-lighthouse spoke 6610",
    checkNote: "CHECKNOTE-reading-a-street-sign-3340",
    practiceNote: "PRACTICENOTE-fell-asleep-during-wbtb-1180",
    answers: "ANSWERS-I notice my fingers and written words most 7705",
  };
  const on = (e: Engine) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
    const r = await e.handle({ method, path, body, query, userId: U });
    if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as any;
  };
  const S = () => on(server);
  // one round of what the app does, with the key: send what changed here sealed, then fetch what changed elsewhere and open it
  async function sync(dev: Engine, id: string, key: Uint8Array | null = KEY) {
    const out = await replica.localChanges(dev.db, 500, key);
    if (out.changes.length) {
      const res = await S()("POST", "/sync/push", { device: id, changes: out.changes });
      await replica.markSent(dev.db, out.upTo);
      if (res.rejected.length) await replica.applyRemote(dev.db, U, res.rejected, undefined, key);
    }
    for (;;) {
      const m = await replica.replicaMeta(dev.db);
      const p = await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: id });
      await replica.applyRemote(dev.db, U, p.changes, p.cursor, key);
      if (!p.more) break;
    }
  }
  /** Every row of every table the server has, as one string (the admin's view: RLS does not apply). */
  async function dumpServer(): Promise<string> {
    const names = (await server.db.admin.query<{ t: string }>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((x) => x.t);
    for (const t of SYNCED) expect(names).toContain(t.name);
    const parts: string[] = [];
    for (const t of names) parts.push(JSON.stringify((await server.db.admin.query(`SELECT to_jsonb(x) AS r FROM ${t} x`)).rows.map((x: any) => x.r)));
    return parts.join("\n");
  }
  let dreamId = "", nightId = "";

  beforeAll(async () => {
    server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
    U = uuidv7();
    await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'u','U')", [U]);
    device = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
    second = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
    deviceId = (await replica.loadSnapshot(device.db, await S()("GET", "/sync/snapshot"), KEY)).device;
  }, 120000);

  it("a dream written on a device reaches the server sealed: no plaintext in any table", async () => {
    const D = on(device);
    const night = await D("POST", "/nights", { date: "2026-11-05", notes: SECRETS.nightNotes, intention: SECRETS.intention, substances: SECRETS.substances });
    nightId = night.id;
    const dream = await D("POST", "/dreams", { nightId: night.id, title: SECRETS.title, text: SECRETS.text, lucid: true, lucidityLevel: 3, lucidTrigger: SECRETS.trigger });
    dreamId = dream.id;
    const element = await D("POST", "/elements", { kind: "character", name: SECRETS.element, aliases: SECRETS.aliases, note: SECRETS.elementNote });
    await D("POST", `/dreams/${dream.id}/elements`, { elementId: element.id, span: SECRETS.span });
    await D("POST", "/reality-checks", { kind: "hands", note: SECRETS.checkNote });
    await D("POST", "/practice", { date: "2026-11-05", item: "wbtb", note: SECRETS.practiceNote });
    await D("PUT", "/course/lesson-1", { state: "done", answers: SECRETS.answers });
    // the device itself reads plaintext
    expect((await D("GET", `/dreams/${dream.id}`)).text).toBe(SECRETS.text);

    await sync(device, deviceId);
    expect(await replica.waitingCount(device.db)).toBe(0);

    const dump = await dumpServer();
    for (const [what, secret] of Object.entries(SECRETS)) {
      // every distinctive string, and every word of it longer than a few letters
      expect(dump, what).not.toContain(secret);
      for (const w of secret.split(/[\s,-]+/).filter((x) => x.length > 4)) expect(dump, `${what}: ${w}`).not.toContain(w);
    }
    // the rows are there, their sealed columns are envelopes, and the plain columns stay usable by the server
    const row = (await server.db.admin.query("SELECT * FROM dreams WHERE id = $1", [dream.id])).rows[0];
    expect(isSealed(row.title)).toBe(true);
    expect(isSealed(row.text)).toBe(true);
    expect(isSealed(row.lucid_trigger)).toBe(true);
    expect(row.lucid).toBe(true);
    expect(row.lucidity_level).toBe(3);
    expect(row.night_id).toBe(night.id);
    expect((await S()("GET", "/nights"))[0].dreamCount).toBe(1);
    // the server's export is the ciphertext as it is, and says so
    const exp = await S()("GET", "/export");
    expect(exp.sealed).toBe(true);
    expect(JSON.stringify(exp)).not.toContain(SECRETS.text);
  });

  it("a second device opens it: from the first copy, and from a later pull", async () => {
    secondId = (await replica.loadSnapshot(second.db, await S()("GET", "/sync/snapshot"), KEY)).device;
    const D2 = on(second);
    const dream = await D2("GET", `/dreams/${dreamId}`);
    expect(dream.title).toBe(SECRETS.title);
    expect(dream.text).toBe(SECRETS.text);
    expect(dream.lucidTrigger).toBe(SECRETS.trigger);
    expect((await D2("GET", `/nights/${nightId}`)).notes).toBe(SECRETS.nightNotes);
    expect((await D2("GET", "/elements"))[0].name).toBe(SECRETS.element);
    // a device's export is plaintext, and says so
    const exp = await D2("GET", "/export");
    expect(exp.sealed).toBe(false);
    expect(exp.tables.dreams[0].text).toBe(SECRETS.text);

    // a change made on the first device after that arrives through pull, opened
    const later = "LATER-the-moon-had-a-door-4040";
    await on(device)("PUT", `/dreams/${dreamId}`, { text: later });
    await sync(device, deviceId);
    expect(await dumpServer()).not.toContain(later);
    await sync(second, secondId);
    expect((await D2("GET", `/dreams/${dreamId}`)).text).toBe(later);
  });

  it("a device without the key sends nothing and takes nothing from sealed tables", async () => {
    const D = on(device);
    const dream = await D("POST", "/dreams", { nightId, text: "UNSENT-never-leaves-without-a-key-0001" });
    const before = await replica.replicaMeta(device.db);
    await expect(replica.localChanges(device.db, 500, null)).rejects.toBeInstanceOf(LockedError);
    // nothing sent, nothing forgotten: the change still waits
    expect((await replica.replicaMeta(device.db)).pushed).toBe(before.pushed);
    expect(await replica.waitingCount(device.db)).toBe(1);
    expect((await server.handle({ method: "GET", path: `/dreams/${dream.id}`, userId: U })).status).toBe(404);
    expect(await dumpServer()).not.toContain("UNSENT-never-leaves");
    // nor can a locked device take sealed rows in (the first copy, or a pull)
    const snap = await S()("GET", "/sync/snapshot");
    const fresh = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
    await expect(replica.loadSnapshot(fresh.db, snap, null)).rejects.toBeInstanceOf(LockedError);
    expect((await replica.replicaMeta(fresh.db)).ready).toBe(false);
    const pull = await S()("GET", "/sync/pull", undefined, { since: "0", device: "someone-else" });
    await expect(replica.applyRemote(fresh.db, U, pull.changes, pull.cursor, null)).rejects.toBeInstanceOf(LockedError);
    // with the key it goes
    await sync(device, deviceId);
    expect(await replica.waitingCount(device.db)).toBe(0);
    expect(isSealed((await server.db.admin.query("SELECT text FROM dreams WHERE id = $1", [dream.id])).rows[0].text)).toBe(true);
  });
});
