// The sealed journal (PLAN.md §4.1, §4.5): sealed columns are ciphertext on the server, bound to their row and
// column, and the server never holds plaintext from a dream written through a device.
import { describe, it, expect, beforeAll } from "vitest";
import { newDataKey, isSealed, sealColumn, unsealColumn, SealError, toBase64url, randomBytes } from "@somnium/shared";
import { createEngine, replica, SEALED_COLUMNS, SEALED_TABLES, sealRows, unsealRows, isJournalRoute, sealRequest, openResponse, previewImport, LockedError, type Engine, type Change } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { SYNCED } from "../src/sync/tables";
import { uuidv7 } from "../src/ids";

const KEY = newDataKey(), OTHER_KEY = newDataKey();
// an answer from the engine: the tests reach into it by name
type Rec = Record<string, any>;
type Snapshot = Parameters<typeof replica.loadSnapshot>[1];

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

  it("keeps nulls, passes plain tables through, and seals whatever a value looks like", async () => {
    const [n] = await sealRows("dreams", [{ id: uuidv7(), title: null, text: "x" }], KEY);
    expect(n!.title).toBeNull();
    const goal = { id: uuidv7(), kind: "journal_streak", target: 3 };
    expect(await sealRows("goals", [goal], null)).toEqual([goal]);
    expect(await unsealRows("goals", [goal], null)).toEqual([goal]);
    // a device's text that merely looks like an envelope is still sealed, and comes back as the same text
    const [again] = await sealRows("dreams", [n!], KEY);
    expect(again!.text).not.toBe(n!.text);
    expect((await unsealRows("dreams", [again!], KEY))[0]!.text).toBe(n!.text);
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
    return r.body as Rec;
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
    for (const t of names) parts.push(JSON.stringify((await server.db.admin.query<{ r: unknown }>(`SELECT to_jsonb(x) AS r FROM ${t} x`)).rows.map((x) => x.r)));
    return parts.join("\n");
  }
  let dreamId = "", nightId = "";

  beforeAll(async () => {
    server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
    U = uuidv7();
    await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'u','U')", [U]);
    device = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
    second = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
    deviceId = (await replica.loadSnapshot(device.db, await S()("GET", "/sync/snapshot") as Snapshot, KEY)).device;
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
    secondId = (await replica.loadSnapshot(second.db, await S()("GET", "/sync/snapshot") as Snapshot, KEY)).device;
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

  it("the direct API path: a request is sealed before it leaves and the answer opened", async () => {
    const lookup = async (path: string) => { const [p, qs] = path.split("?"); return (await S()("GET", p!, undefined, Object.fromEntries(new URLSearchParams(qs ?? "")))); };
    const call = async (method: string, path: string, body?: unknown) => {
      const out = await sealRequest(method, path, body, KEY, lookup);
      const { data } = await openResponse(path, await S()(method, path, out), KEY);
      return data as Rec;
    };
    const SECRET = { notes: "DIRECT-NOTES-amber-kettle-1101", text: "DIRECT-TEXT-paper-boats-1102", name: "DIRECT-NAME-copper-fox-1103", span: "DIRECT-SPAN-1104", span2: "DIRECT-SPANTWO-1105", answers: "DIRECT-ANSWERS-1106", answers2: "DIRECT-ANSWERSTWO-1107", note: "DIRECT-NOTE-1108", check: "DIRECT-CHECK-1109" };
    const night = await call("POST", "/nights", { date: "2026-10-01", notes: SECRET.notes });
    expect(night.notes).toBe(SECRET.notes);
    const dream = await call("POST", "/dreams", { nightId: night.id, text: SECRET.text, lucid: true });
    expect(dream.text).toBe(SECRET.text);
    expect((await call("PUT", `/dreams/${dream.id}`, { text: SECRET.text + "!" })).text).toBe(SECRET.text + "!");
    const element = await call("POST", "/elements", { kind: "place", name: SECRET.name });
    // linking again updates the row that is there, so the new value must be sealed for that row
    const link = await call("POST", `/dreams/${dream.id}/elements`, { elementId: element.id, span: SECRET.span });
    expect(link.span).toBe(SECRET.span);
    const relink = await call("POST", `/dreams/${dream.id}/elements`, { elementId: element.id, span: SECRET.span2 });
    expect(relink.id).toBe(link.id);
    expect(relink.span).toBe(SECRET.span2);
    // so must the second write to a lesson
    const lesson = await call("PUT", "/course/direct-1", { answers: SECRET.answers });
    const lesson2 = await call("PUT", "/course/direct-1", { answers: SECRET.answers2 });
    expect(lesson2.id).toBe(lesson.id);
    expect(lesson2.answers).toBe(SECRET.answers2);
    expect((await call("POST", "/practice", { date: "2026-10-01", item: "wbtb", note: SECRET.note })).note).toBe(SECRET.note);
    expect((await call("POST", "/reality-checks", { kind: "hands", note: SECRET.check })).note).toBe(SECRET.check);
    // lists and rows nested in an answer open too
    expect((await call("GET", "/nights")).find((n: Rec) => n.id === night.id).notes).toBe(SECRET.notes);
    const full = await call("GET", `/nights/${night.id}`);
    expect(full.notes).toBe(SECRET.notes);
    expect(full.dreams[0].text).toBe(SECRET.text + "!");
    expect((await call("GET", `/dreams/${dream.id}`)).elements[0].span).toBe(SECRET.span2);
    expect((await call("GET", `/elements/${element.id}`)).dreams[0].span).toBe(SECRET.span2);
    expect((await call("DELETE", `/reality-checks/${(await call("GET", "/reality-checks"))[0].id}`))).toEqual({ ok: true });

    const dump = await dumpServer();
    for (const secret of Object.values(SECRET)) expect(dump).not.toContain(secret);

    // an export opens on the device, and a plain file is sealed again on its way back
    const plain = await call("GET", "/export");
    expect(plain.sealed).toBe(false);
    expect(plain.tables.nights.find((n: Rec) => n.id === night.id).notes).toBe(SECRET.notes);
    const body = await sealRequest("POST", "/import", { data: plain, mode: "merge" }, KEY, lookup) as Rec;
    expect(body.data.sealed).toBe(true);
    expect(isSealed(body.data.tables.nights.find((n: Rec) => n.id === night.id).notes)).toBe(true);
    await S()("POST", "/import", body);
    expect(await dumpServer()).not.toContain(SECRET.notes);

    // which routes need the key, and which never do; a restore's preview is counted on the device
    for (const p of ["/dreams", "/nights/x", "/elements", "/reality-checks", "/practice", "/course/a", "/import", "/export", "/dreams/x/elements"]) expect(isJournalRoute(p), p).toBe(true);
    for (const p of ["/settings", "/auth/status", "/admin/users", "/version", "/sync/push", "/goals", "/import/preview"]) expect(isJournalRoute(p), p).toBe(false);
    expect(previewImport({ data: { app: "somnium", tables: { dreams: [{}, {}] } } })!.counts.dreams).toBe(2);
    expect(previewImport({ data: { app: "other" } })).toBeNull();
  });

  it("the server refuses plaintext in a sealed column, by every path", async () => {
    const refused = async (method: string, path: string, body: unknown) => {
      const r = await server.handle({ method, path, body, userId: U });
      expect(r.status, `${method} ${path}`).toBe(400);
      expect((r.body as Rec).error).toMatch(/sealed by the app/);
    };
    const PLAIN = "REFUSED-plain-text-2201";
    const ok = await S()("POST", "/elements", { id: uuidv7(), kind: "place" });
    await refused("POST", "/nights", { id: uuidv7(), date: "2026-09-01", notes: PLAIN });
    await refused("PUT", `/nights/${nightId}`, { intention: PLAIN });
    await refused("POST", "/dreams", { id: uuidv7(), nightId, text: PLAIN });
    await refused("PUT", `/dreams/${dreamId}`, { title: PLAIN });
    await refused("POST", "/elements", { id: uuidv7(), name: PLAIN });
    await refused("PUT", `/elements/${ok.id}`, { aliases: PLAIN });
    await refused("POST", `/dreams/${dreamId}/elements`, { id: uuidv7(), elementId: ok.id, span: PLAIN });
    await refused("POST", "/reality-checks", { id: uuidv7(), note: PLAIN });
    await refused("POST", "/practice", { id: uuidv7(), date: "2026-09-01", item: "x", note: PLAIN });
    await refused("PUT", "/course/refused-1", { id: uuidv7(), answers: PLAIN });
    const row = { id: dreamId, night_id: nightId, text: PLAIN };
    await refused("POST", "/sync/push", { device: "d", changes: [{ tbl: "dreams", pk: { id: dreamId }, op: "upsert", at: new Date().toISOString(), row }] });
    const before = (await server.db.admin.query("SELECT count(*)::int AS n FROM dreams")).rows[0].n;
    await refused("POST", "/import", { mode: "replace", data: { app: "somnium", format: 1, sealed: true, tables: { dreams: [row] } } });
    // refused before the replace took anything away
    expect((await server.db.admin.query("SELECT count(*)::int AS n FROM dreams")).rows[0].n).toBe(before);
    expect(await dumpServer()).not.toContain(PLAIN);

    // an envelope sealed for a row id the server would have to make up could never be opened
    await refused("POST", "/reality-checks", { note: await sealColumn("x", KEY, "reality_checks", "note", uuidv7()) });
    // and a write sealed for another row than the one the server finds is sent back
    const id = uuidv7();
    await S()("PUT", "/course/conflict-1", { id, answers: await sealColumn("a", KEY, "course_progress", "answers", id) });
    const other = uuidv7();
    const r = await server.handle({ method: "PUT", path: "/course/conflict-1", userId: U, body: { id: other, answers: await sealColumn("b", KEY, "course_progress", "answers", other) } });
    expect(r.status).toBe(409);

    // on a device plaintext is what belongs there
    expect((await on(device)("POST", "/reality-checks", { note: "plain is fine here" })).note).toBe("plain is fine here");
    await sync(device, deviceId);
  });

  it("a row that doesn't open is skipped and reported, without stalling the rest, and tried again later", async () => {
    const fresh = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
    await replica.loadSnapshot(fresh.db, { cursor: 0, user: { id: U, username: "u" }, tables: {} }, KEY);
    const at = new Date().toISOString();
    const nid = uuidv7(), badId = uuidv7();
    const change = async (tbl: string, id: string, row: Rec, key: Uint8Array, col: string, text: string): Promise<Change> =>
      ({ tbl, pk: { id }, op: "upsert", at, row: { id, ...row, [col]: await sealColumn(text, key, tbl, col, id) } });
    const good = await change("nights", nid, { date: "2026-08-01" }, KEY, "notes", "opens fine");
    // sealed under another key: this page must still go through
    const bad = await change("nights", badId, { date: "2026-08-02" }, OTHER_KEY, "notes", "doesn't open");
    const res = await replica.applyRemote(fresh.db, U, [bad, good], 7, KEY);
    expect(res.unopened).toBe(1);
    expect((await replica.replicaMeta(fresh.db)).cursor).toBe(7);
    expect((await fresh.handle({ method: "GET", path: `/nights/${nid}`, userId: U })).status).toBe(200);
    expect((await fresh.handle({ method: "GET", path: `/nights/${badId}`, userId: U })).status).toBe(404);
    expect((await replica.replicaMeta(fresh.db)).unopened).toHaveLength(1);
    // the same key again: still set aside, still counted once
    expect((await replica.applyRemote(fresh.db, U, [], 7, KEY)).unopened).toBe(1);
    // with the key it was sealed under, it arrives after all, and nothing stays set aside
    expect((await replica.applyRemote(fresh.db, U, [], 7, OTHER_KEY)).unopened).toBe(0);
    expect((await fresh.handle({ method: "GET", path: `/nights/${badId}`, userId: U })).status).toBe(200);

    // a plain value is kept as plain: the accepted limit in docs/security.md
    const injected = uuidv7();
    await replica.applyRemote(fresh.db, U, [{ tbl: "nights", pk: { id: injected }, op: "upsert", at, row: { id: injected, date: "2026-08-03", notes: "not an envelope" } }], 7, KEY);
    expect(((await fresh.handle({ method: "GET", path: `/nights/${injected}`, userId: U })).body as Rec).notes).toBe("not an envelope");

    // one bad row in a first copy doesn't stop it either, and its children stay out with it
    const snapDevice = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
    const badNight = uuidv7(), child = uuidv7();
    await S()("POST", "/nights", { id: badNight, date: "2026-06-06", notes: await sealColumn("doesn't open", OTHER_KEY, "nights", "notes", badNight) });
    await S()("POST", "/dreams", { id: child, nightId: badNight, lucid: true });
    await replica.loadSnapshot(snapDevice.db, await S()("GET", "/sync/snapshot") as Snapshot, KEY);
    const meta = await replica.replicaMeta(snapDevice.db);
    expect(meta.ready).toBe(true);
    expect(meta.unopened!.map((c) => c.pk.id)).toEqual([badNight]);
    const nightIds = (await snapDevice.db.admin.query<{ id: string }>("SELECT id FROM nights")).rows.map((n) => n.id);
    expect(nightIds).toContain(nightId);
    expect(nightIds).not.toContain(badNight);
    expect((await snapDevice.db.admin.query("SELECT id FROM dreams WHERE id = $1", [child])).rows).toHaveLength(0);
    expect((await snapDevice.db.admin.query("SELECT id FROM dreams WHERE id = $1", [dreamId])).rows).toHaveLength(1);
    expect((await unsealColumn((bad.row as Rec).notes, OTHER_KEY, "nights", "notes", badId))).toBe("doesn't open");
  });

  it("while locked, settings, goals and reminders still travel and the journal waits", async () => {
    const D = on(device);
    const waitingDream = await D("POST", "/dreams", { nightId, text: "LOCKED-waits-3301" });
    const goal = await D("POST", "/goals", { kind: "journal_streak", target: 5 });
    const out = await replica.plainChanges(device.db);
    expect(out.changes.map((c) => c.tbl)).toEqual(["goals"]);
    await S()("POST", "/sync/push", { device: deviceId, changes: out.changes });
    await replica.markPlainSent(device.db, out.upTo);
    expect((await replica.plainChanges(device.db)).changes).toEqual([]);
    expect((await server.handle({ method: "GET", path: "/goals", userId: U })).body).toEqual(expect.arrayContaining([expect.objectContaining({ id: goal.id })]));
    // the dream is still waiting, and hasn't left
    expect(await replica.waitingCount(device.db)).toBe(1);
    expect(await dumpServer()).not.toContain("LOCKED-waits");

    // a goal made elsewhere arrives while locked; sealed rows in the same page wait for the real cursor
    const before = await replica.replicaMeta(second.db);
    const otherGoal = await S()("POST", "/goals", { kind: "journal_streak", target: 9 });
    const night2 = uuidv7();
    await S()("POST", "/nights", { id: night2, date: "2026-07-07", notes: await sealColumn("for after unlocking", KEY, "nights", "notes", night2) });
    const page = await S()("GET", "/sync/pull", undefined, { since: String(await replica.plainSince(second.db)), device: secondId });
    await replica.takePlain(second.db, U, page.changes, page.cursor);
    expect((await on(second)("GET", "/goals")).map((g: Rec) => g.id)).toContain(otherGoal.id);
    expect((await second.handle({ method: "GET", path: `/nights/${night2}`, userId: U })).status).toBe(404);
    expect((await replica.replicaMeta(second.db)).cursor).toBe(before.cursor);
    expect(await replica.plainSince(second.db)).toBe(page.cursor);
    // unlocked: the same cursor now brings the sealed row, opened, and the dream goes out sealed
    await sync(second, secondId);
    expect((await on(second)("GET", `/nights/${night2}`)).notes).toBe("for after unlocking");
    await sync(device, deviceId);
    expect(await replica.waitingCount(device.db)).toBe(0);
    expect(isSealed((await server.db.admin.query("SELECT text FROM dreams WHERE id = $1", [waitingDream.id])).rows[0].text)).toBe(true);
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
    const snap = await S()("GET", "/sync/snapshot") as Snapshot;
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
