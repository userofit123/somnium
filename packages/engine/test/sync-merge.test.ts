// LDJ-52: two devices that log the same night while offline. The night made first survives (created_at, then id);
// the other is soft-deleted with merged_into, its dreams move over (only night_id changes), and a device holding the
// key copies its fields into the survivor: differing free text is joined (survivor's first), technique lists are
// joined, other plain values go newest updated_at first. Absorbing heals itself (a lost join is made again) without
// bringing back text the person removed, and what a device claims about a merge is checked. Also: a lesson or link deleted on one
// device while another holds a live duplicate under another id.
import { describe, it, expect, beforeAll } from "vitest";
import { newDataKey, isSealed, unsealColumn, SealError } from "@somnium/shared";
import { createEngine, replica, type Engine, type Change } from "../src/index";
import { mergeNightFields, joinText, nightFingerprint } from "../src/sync/core";
import { migrate } from "../src/migrate";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { SEALED_COLUMNS } from "../src/sealed";

const KEY = newDataKey();
type Rec = Record<string, any>;

let server: Engine, U: string;
const on = (e: Engine) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await e.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`), { status: r.status });
  return r.body as any;
};
const S = () => on(server);
const later = () => new Promise((ok) => setTimeout(ok, 5));

interface Device { eng: Engine; id: string }
async function newDevice(): Promise<Device> {
  const eng = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
  const m = await replica.loadSnapshot(eng.db, await S()("GET", "/sync/snapshot"), KEY);
  return { eng, id: m.device };
}
// one round of what the app does: send what changed here (taking the push's answer), then fetch what changed elsewhere.
// Nothing may fail, be held back or stay unopened.
async function sync(d: Device) {
  for (;;) {
    const out = await replica.localChanges(d.eng.db, 500, KEY);
    if (!out.changes.length) break;
    const res = await S()("POST", "/sync/push", { device: d.id, changes: out.changes });
    expect(res.failed).toEqual([]);
    await replica.markSent(d.eng.db, out.upTo);
    if (res.rejected.length) expect((await replica.applyRemote(d.eng.db, U, res.rejected, undefined, KEY)).failed).toEqual([]);
  }
  await pull(d);
}
async function pull(d: Device) {
  for (;;) {
    const m = await replica.replicaMeta(d.eng.db);
    const p = await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: d.id });
    const r = await replica.applyRemote(d.eng.db, U, p.changes, p.cursor, KEY);
    expect([r.failed, r.heldBack, r.unopened]).toEqual([[], 0, 0]);
    if (!p.more) break;
  }
}
const settled = async (d: Device) => {
  const m = await replica.replicaMeta(d.eng.db);
  expect([m.heldBack ?? [], m.unopened ?? []]).toEqual([[], []]);
  expect((await d.eng.db.admin.query("SELECT id FROM nights WHERE merge_pending")).rows).toEqual([]);
  expect(await replica.waitingCount(d.eng.db)).toBe(0);
};

beforeAll(async () => {
  server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  U = uuidv7();
  await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'u','U')", [U]);
}, 120000);

// send what changed here, taking the push's answer, without fetching anything else
async function push(d: Device) {
  for (;;) {
    const out = await replica.localChanges(d.eng.db, 500, KEY);
    if (!out.changes.length) return;
    const res = await S()("POST", "/sync/push", { device: d.id, changes: out.changes });
    expect([res.failed, res.mergeFailed]).toEqual([[], 0]);
    await replica.markSent(d.eng.db, out.upTo);
    if (res.rejected.length) await replica.applyRemote(d.eng.db, U, res.rejected, undefined, KEY);
  }
}
const nightsOn = async (e: Engine, date: string) => ((await on(e)("GET", "/nights")) as Rec[]).filter((n) => n.date === date);
const serverRow = async (tbl: string, id: string) => (await server.db.admin.query(`SELECT * FROM ${tbl} WHERE id = $1`, [id])).rows[0] as Rec;
const opens = (tbl: string, col: string, v: string, id: string) => unsealColumn(v, KEY, tbl, col, id);
let day = 0;
const nextDate = () => { day++; return `2026-${String(8 + Math.floor(day / 28)).padStart(2, "0")}-${String(1 + (day % 28)).padStart(2, "0")}`; };

// whole rounds of sync between several devices: slower than one test usually is
describe("two devices that log the same night offline", { timeout: 30000 }, () => {
  const BOTH = "notes from a\n\nnotes from b";
  async function both(order: "first-made pushed first" | "first-made pushed second") {
    const date = nextDate();
    // c is a third device that was signed in all along and only pulls; it is checked at the end, with one made afterwards
    const a = await newDevice(), b = await newDevice(), c = await newDevice();
    const na = await on(a.eng)("POST", "/nights", { date, notes: "notes from a", sleepQuality: 2, techniquesPlanned: ["mild"] });
    const da = await on(a.eng)("POST", "/dreams", { nightId: na.id, text: "the dream a wrote" });
    await later();
    const nb = await on(b.eng)("POST", "/nights", { date, notes: "notes from b", intention: "look at my hands", substances: "coffee", sleepQuality: 4, wbtbUsed: true, techniquesPlanned: ["wbtb", "mild"] });
    const db = await on(b.eng)("POST", "/dreams", { nightId: nb.id, text: "the dream b wrote" });
    await later();
    // b goes on writing under its own night while still offline, after the night was made
    const db2 = await on(b.eng)("POST", "/dreams", { nightId: nb.id, text: "a second dream on b" });

    const [first, second] = order === "first-made pushed first" ? [a, b] : [b, a];
    await sync(first); await sync(second); await sync(first); await sync(second); await sync(first);
    await pull(c);
    const d = await newDevice();
    for (const x of [a, b, c, d]) await settled(x);
    return { a, b, c, d, na, nb, dreams: [da, db, db2], date };
  }

  async function check(r: Awaited<ReturnType<typeof both>>, notes = BOTH) {
    const { na, nb, dreams, date } = r;
    for (const x of [r.a, r.b, r.c, r.d]) {
      const nights = await nightsOn(x.eng, date);
      // one live night, the one made first, holding every dream with its text readable
      expect(nights.map((n) => n.id)).toEqual([na.id]);
      // both people's words survive, the survivor's first; plain values newest first; technique lists joined
      expect(nights[0]).toMatchObject({ notes, intention: "look at my hands", substances: "coffee", sleepQuality: 4, wbtbUsed: true, techniquesPlanned: ["mild", "wbtb"] });
      const night = await on(x.eng)("GET", `/nights/${na.id}`);
      expect((night.dreams as Rec[]).map((d) => d.id).sort()).toEqual(dreams.map((d) => d.id).sort());
      expect((night.dreams as Rec[]).map((d) => d.text).sort()).toEqual(["a second dream on b", "the dream a wrote", "the dream b wrote"]);
      const gone = (await x.eng.db.admin.query("SELECT deleted_at, merged_into FROM nights WHERE id = $1", [nb.id])).rows[0];
      expect(gone.merged_into).toBe(na.id);
      expect(gone.deleted_at).not.toBeNull();
    }
    // the server: one live night for the date, every dream under it, nothing in the clear
    const live = (await server.db.admin.query("SELECT * FROM nights WHERE user_id = $1 AND date = $2 AND deleted_at IS NULL", [U, date])).rows;
    expect(live.map((n: Rec) => n.id)).toEqual([na.id]);
    const sv = live[0]!;
    for (const col of SEALED_COLUMNS.nights!) expect(isSealed(sv[col]), col).toBe(true);
    // the joined notes and the copied intention and substances were sealed again for the survivor's id, and open only for it
    expect(await opens("nights", "notes", sv.notes, na.id)).toBe(notes);
    expect(await opens("nights", "intention", sv.intention, na.id)).toBe("look at my hands");
    expect(await opens("nights", "substances", sv.substances, na.id)).toBe("coffee");
    await expect(opens("nights", "notes", sv.notes, nb.id)).rejects.toBeInstanceOf(SealError);
    // the record of what the survivor took in is sealed too, and names b's night
    expect(Object.keys(JSON.parse(await opens("nights", "absorbed", sv.absorbed, na.id)))).toEqual([nb.id]);
    // b's night stays under its own id, its own words still sealed for it alone
    const loser = await serverRow("nights", nb.id);
    expect(loser.merged_into).toBe(na.id);
    // and it says, sealed for its own id, that it handed its plain values over (once, ever)
    expect(JSON.parse(await opens("nights", "absorbed", loser.absorbed, nb.id))).toEqual({ given: true });
    for (const [col, v] of [["notes", "notes from b"], ["intention", "look at my hands"], ["substances", "coffee"]] as const) {
      expect(isSealed(loser[col])).toBe(true);
      expect(await opens("nights", col, loser[col], nb.id)).toBe(v);
      await expect(opens("nights", col, loser[col], na.id)).rejects.toBeInstanceOf(SealError);
    }
    const ds = (await server.db.admin.query("SELECT id, night_id, text FROM dreams WHERE id = ANY($1::uuid[])", [dreams.map((d) => d.id)])).rows;
    expect(ds).toHaveLength(3);
    for (const d of ds) {
      expect(d.night_id).toBe(na.id);
      expect(isSealed(d.text)).toBe(true);
      expect(await opens("dreams", "text", d.text, d.id)).toMatch(/dream/);
    }
  }

  /** More syncs change nothing (the text isn't doubled), and text the person removes from the survivor stays removed. */
  async function again(r: Awaited<ReturnType<typeof both>>) {
    for (const x of [r.a, r.b, r.c, r.d, r.a, r.b]) await sync(x);
    for (const x of [r.a, r.b, r.c, r.d]) await settled(x);
    const rows = (await r.a.eng.db.admin.query("SELECT to_jsonb(n) AS r FROM nights n WHERE id = ANY($1::uuid[])", [[r.na.id, r.nb.id]])).rows.map((x: any) => x.r);
    expect(await mergeNightFields(rows.find((n: Rec) => n.id === r.na.id), rows.find((n: Rec) => n.id === r.nb.id), await nightFingerprint(KEY))).toEqual({ survivor: {}, loser: {} });
    await check(r);
    await on(r.c.eng)("PUT", `/nights/${r.na.id}`, { notes: "notes from a" });
    for (const x of [r.c, r.a, r.b, r.d, r.c, r.a, r.b, r.d]) await sync(x);
    await check(r, "notes from a");
  }

  it("ends with one night holding every dream when the night made first is pushed first", async () => {
    const r = await both("first-made pushed first");
    await check(r);
    await again(r);
  });

  it("ends the same when the night made first is pushed second", async () => {
    const r = await both("first-made pushed second");
    await check(r);
    await again(r);
  });

  it("joins differing text, keeps the longer when one holds the other, and hands plain values and lists over once", async () => {
    expect(joinText("a", "b")).toBe("a\n\nb");
    expect(joinText("tea and a walk", "tea")).toBe("tea and a walk");
    expect(joinText("tea", "tea and a walk")).toBe("tea and a walk");
    const fp = await nightFingerprint(KEY);
    const s = { id: "s", updated_at: "2026-01-02T00:00:00Z", notes: "mine", substances: "tea", intention: null, sleep_quality: 3, techniques_done: ["mild"] };
    const l = { id: "l", updated_at: "2026-01-01T00:00:00Z", notes: "theirs", substances: "tea", intention: "fly", sleep_quality: 5, techniques_done: ["wild", "mild"] };
    // the loser is older: its rating loses, but none of its words do
    const p = await mergeNightFields(s, l, fp);
    expect(p.survivor).toMatchObject({ notes: "mine\n\ntheirs", intention: "fly", techniques_done: ["mild", "wild"] });
    expect(Object.keys(p.survivor).sort()).toEqual(["absorbed", "intention", "notes", "techniques_done"]);
    expect(JSON.parse(p.loser.absorbed as string)).toEqual({ given: true });
    const merged = { ...s, ...p.survivor }, given = { ...l, ...p.loser };
    const none = { survivor: {}, loser: {} };
    expect(await mergeNightFields(merged, given, fp)).toEqual(none);
    // the person removed the joined text, or a technique that came over: neither is added back
    expect(await mergeNightFields({ ...merged, notes: "mine", intention: null }, given, fp)).toEqual(none);
    expect(await mergeNightFields({ ...merged, techniques_done: ["mild"] }, given, fp)).toEqual(none);
    // the joined version was lost (record and all): the words are joined again, the lists and plain values aren't
    const healed = await mergeNightFields(s, given, fp);
    expect(healed.survivor).toMatchObject({ notes: "mine\n\ntheirs", intention: "fly" });
    expect(Object.keys(healed.survivor).sort()).toEqual(["absorbed", "intention", "notes"]);
    expect(healed.loser).toEqual({});
    // the merged night's text changed since (a newer version of it came back and was merged again): the new text is added
    expect((await mergeNightFields(merged, { ...given, notes: "theirs, and more" }, fp)).survivor).toMatchObject({ notes: "mine\n\ntheirs\n\ntheirs, and more" });
    // "no recall" holds if either night said so, unless the night now has dreams
    expect((await mergeNightFields({ ...s, no_recall: false }, { ...l, no_recall: true }, fp)).survivor.no_recall).toBe(true);
    expect((await mergeNightFields({ ...s, no_recall: false }, { ...l, no_recall: true }, fp, { dreams: true })).survivor.no_recall).toBeUndefined();
    expect((await mergeNightFields({ ...s, no_recall: true }, l, fp, { dreams: true })).survivor.no_recall).toBe(false);
    // keyed: the record holds no text, and the same text gives another fingerprint under another key
    const rec = JSON.parse(p.survivor.absorbed as string).l;
    expect(Object.values(rec)).not.toContain("theirs");
    expect(rec.notes).toBe(await fp("theirs"));
    expect(await (await nightFingerprint(newDataKey()))("theirs")).not.toBe(rec.notes);
  });

  it("keeps a field only the survivor has, and both nights' notes when they differ", async () => {
    const a = await newDevice(), b = await newDevice();
    const date = nextDate();
    const nb = await on(b.eng)("POST", "/nights", { date, notes: "older notes from b", substances: "tea" });
    await later();
    const na = await on(a.eng)("POST", "/nights", { date, notes: "newer notes from a" });
    // b's night was made first and survives: its notes come first, a's follow, and b's substances stay.
    // b copies a's notes in when it hears of the merge, and sends that on its next round
    await sync(a); await sync(b); await sync(a); await sync(b); await sync(a);
    for (const x of [a, b]) {
      const n = await nightsOn(x.eng, date);
      expect(n.map((v) => v.id)).toEqual([nb.id]);
      expect(n[0]).toMatchObject({ notes: "older notes from b\n\nnewer notes from a", substances: "tea" });
      await settled(x);
    }
    expect((await serverRow("nights", na.id)).merged_into).toBe(nb.id);
    const sv = await serverRow("nights", nb.id);
    expect(isSealed(sv.notes)).toBe(true);
    expect(await opens("nights", "notes", sv.notes, nb.id)).toBe("older notes from b\n\nnewer notes from a");
  });

  it("leaves naps alone", async () => {
    const a = await newDevice(), b = await newDevice();
    const date = nextDate();
    await on(a.eng)("POST", "/nights", { date });
    await on(b.eng)("POST", "/nights", { date, nap: true });
    await sync(a); await sync(b); await sync(a);
    expect(await nightsOn(a.eng, date)).toHaveLength(2);
  });

  it("follows a chain: A into B, then B into C", async () => {
    const date = nextDate();
    const x = await newDevice(), y = await newDevice(), z = await newDevice();
    const nc = await on(z.eng)("POST", "/nights", { date, notes: "c" });
    const dc = await on(z.eng)("POST", "/dreams", { nightId: nc.id, text: "dream c" });
    await later();
    const nb = await on(y.eng)("POST", "/nights", { date, notes: "b" });
    const db = await on(y.eng)("POST", "/dreams", { nightId: nb.id, text: "dream b" });
    await later();
    const na = await on(x.eng)("POST", "/nights", { date, notes: "a" });
    const da = await on(x.eng)("POST", "/dreams", { nightId: na.id, text: "dream a" });
    // x and y meet first (A into B), z only later (B into C)
    await sync(x); await sync(y); await sync(x); await sync(y);
    expect((await serverRow("nights", na.id)).merged_into).toBe(nb.id);
    for (let i = 0; i < 3; i++) for (const d of [z, x, y]) await sync(d);
    expect((await serverRow("nights", nb.id)).merged_into).toBe(nc.id);
    for (const d of [x, y, z]) {
      const n = await nightsOn(d.eng, date);
      expect(n.map((v) => v.id)).toEqual([nc.id]);
      expect(n[0]!.notes).toBe("c\n\nb\n\na");
      expect(((await on(d.eng)("GET", `/nights/${nc.id}`)).dreams as Rec[]).map((v) => v.id).sort()).toEqual([da.id, db.id, dc.id].sort());
      await settled(d);
    }
    expect(await opens("nights", "notes", (await serverRow("nights", nc.id)).notes, nc.id)).toBe("c\n\nb\n\na");
  });

  it("comes out the same when two devices absorb at the same time", async () => {
    const date = nextDate();
    const a = await newDevice(), b = await newDevice();
    const na = await on(a.eng)("POST", "/nights", { date, notes: "notes from a" });
    await later();
    const nb = await on(b.eng)("POST", "/nights", { date, notes: "notes from b" });
    await push(a); await push(b);
    // both hear of the merge and both join the survivor before either sends
    await pull(a); await pull(b);
    for (const d of [a, b]) expect((await nightsOn(d.eng, date))[0]!.notes).toBe(BOTH);
    await push(a); await push(b);
    for (let i = 0; i < 2; i++) { await sync(a); await sync(b); }
    for (const d of [a, b]) { expect((await nightsOn(d.eng, date)).map((n) => [n.id, n.notes])).toEqual([[na.id, BOTH]]); await settled(d); }
    expect(await opens("nights", "notes", (await serverRow("nights", na.id)).notes, na.id)).toBe(BOTH);
    expect((await serverRow("nights", nb.id)).merged_into).toBe(na.id);
  });

  it("joins again when an edit to the survivor made without hearing of the merge wins", async () => {
    const date = nextDate();
    const a = await newDevice(), b = await newDevice();
    const na = await on(a.eng)("POST", "/nights", { date, notes: "notes from a" });
    await later();
    await on(b.eng)("POST", "/nights", { date, notes: "notes from b" });
    await push(a); await push(b); await pull(b);
    await push(b); // the joined survivor reaches the server
    await later();
    // a hasn't pulled: it edits its own copy (without b's words, without the record), and that newer row wins
    await on(a.eng)("PUT", `/nights/${na.id}`, { sleepQuality: 5 });
    await push(a);
    expect(await opens("nights", "notes", (await serverRow("nights", na.id)).notes, na.id)).toBe("notes from a");
    for (let i = 0; i < 3; i++) { await sync(b); await sync(a); }
    for (const d of [a, b]) { expect((await nightsOn(d.eng, date))[0]).toMatchObject({ notes: BOTH, sleepQuality: 5 }); await settled(d); }
    expect(await opens("nights", "notes", (await serverRow("nights", na.id)).notes, na.id)).toBe(BOTH);
  });

  it("joins again when a clock behind makes the server keep the unjoined survivor", async () => {
    const date = nextDate();
    const a = await newDevice(), b = await newDevice();
    const na = await on(a.eng)("POST", "/nights", { date, notes: "notes from a" });
    await later();
    await on(b.eng)("POST", "/nights", { date, notes: "notes from b" });
    await push(a); await push(b); await pull(b);
    // b's clock is a day behind: its joined survivor is older than what the server has, and is refused
    await b.eng.db.admin.query("UPDATE sync_log SET at = at - interval '1 day'");
    const out = await replica.localChanges(b.eng.db, 500, KEY);
    const res = await S()("POST", "/sync/push", { device: b.id, changes: out.changes });
    expect(res.rejected.map((c: Change) => c.pk.id)).toContain(na.id);
    await replica.markSent(b.eng.db, out.upTo);
    // the server's version comes back, and b joins it again (this time with a log time the server takes)
    await replica.applyRemote(b.eng.db, U, res.rejected, undefined, KEY);
    expect((await nightsOn(b.eng, date))[0]!.notes).toBe(BOTH);
    for (let i = 0; i < 2; i++) { await sync(b); await sync(a); }
    for (const d of [a, b]) { expect((await nightsOn(d.eng, date))[0]!.notes).toBe(BOTH); await settled(d); }
    expect(await opens("nights", "notes", (await serverRow("nights", na.id)).notes, na.id)).toBe(BOTH);
  });

  it("brings a merged night back when its survivor is deleted and it still has a live dream", async () => {
    const date = nextDate();
    const a = await newDevice(), b = await newDevice();
    const na = await on(a.eng)("POST", "/nights", { date, notes: "notes from a" });
    await later();
    const nb = await on(b.eng)("POST", "/nights", { date, notes: "notes from b" });
    const db = await on(b.eng)("POST", "/dreams", { nightId: nb.id, text: "seen and deleted" });
    await push(a); await push(b);
    // a sees b's dream under its night, and deletes the night with it
    await sync(a); await sync(a);
    expect(((await on(a.eng)("GET", `/nights/${na.id}`)).dreams as Rec[]).map((d) => d.id)).toEqual([db.id]);
    await on(a.eng)("DELETE", `/nights/${na.id}`);
    await sync(a);
    // nothing left to do for b's night: it isn't tried again and isn't brought back
    expect((await serverRow("nights", nb.id)).deleted_at).not.toBeNull();
    // b, still not having heard, writes another dream under its own night
    const db2 = await on(b.eng)("POST", "/dreams", { nightId: nb.id, text: "written later on b" });
    for (let i = 0; i < 2; i++) { await sync(b); await sync(a); }
    for (const d of [a, b]) {
      const n = await nightsOn(d.eng, date);
      expect(n.map((v) => v.id)).toEqual([nb.id]);
      expect(((await on(d.eng)("GET", `/nights/${nb.id}`)).dreams as Rec[]).map((v) => [v.id, v.text])).toEqual([[db2.id, "written later on b"]]);
      await settled(d);
    }
    const back = await serverRow("nights", nb.id);
    expect([back.deleted_at, back.merged_into]).toEqual([null, null]);
    expect((await serverRow("dreams", db2.id)).night_id).toBe(nb.id);
  });
});

describe("undo of a deleted dream", () => {
  it("syncs: deleted on one device, restored there, live on the server and the other device", async () => {
    const date = nextDate();
    const a = await newDevice(), b = await newDevice();
    const n = await on(a.eng)("POST", "/nights", { date });
    const d = await on(a.eng)("POST", "/dreams", { nightId: n.id, text: "back again" });
    await sync(a); await sync(b);
    await later();
    await on(a.eng)("DELETE", `/dreams/${d.id}`);
    await sync(a); await sync(b);
    expect((await serverRow("dreams", d.id)).deleted_at).not.toBeNull();
    await later();
    await on(a.eng)("POST", `/dreams/${d.id}/restore`);
    for (let i = 0; i < 2; i++) { await sync(a); await sync(b); }
    expect((await serverRow("dreams", d.id)).deleted_at).toBeNull();
    for (const x of [a, b]) expect((await on(x.eng)("GET", `/dreams/${d.id}`)).id).toBe(d.id);
  });
});

describe("what a device says about a merge is checked", () => {
  const fake = uuidv7();
  const send = async (changes: Change[]) => S()("POST", "/sync/push", { device: fake, changes });
  const night = (o: Rec): Change => {
    const id = o.id ?? uuidv7(), at = new Date().toISOString();
    return { tbl: "nights", pk: { id }, op: "upsert", at, row: { created_at: at, updated_at: at, ...o, id } };
  };
  const dream = (nightId: string): Change => { const id = uuidv7(), at = new Date().toISOString(); return { tbl: "dreams", pk: { id }, op: "upsert", at, row: { id, night_id: nightId, created_at: at, updated_at: at } }; };

  it("refuses a night without created_at", async () => {
    const n = night({ date: nextDate() });
    delete n.row!.created_at;
    const res = await send([n]);
    expect(res.failed.map((f: Rec) => f.pk.id)).toEqual([n.pk.id]);
  });

  it("clears merged_into on a live night (a restore), and merges it again by the rule if it clashes", async () => {
    const date = nextDate();
    const lone = night({ date: nextDate(), merged_into: uuidv7() });
    const first = night({ date });
    await later();
    const second = night({ date, deleted_at: new Date().toISOString(), merged_into: first.pk.id });
    await send([lone, first, second]);
    expect((await serverRow("nights", lone.pk.id as string)).merged_into).toBeNull();
    expect((await serverRow("nights", second.pk.id as string)).merged_into).toBe(first.pk.id);
    // the merged night restored (deleted_at cleared, its link still there): the link goes, and the rule merges it again
    await later();
    await send([night({ ...second.row, deleted_at: null, updated_at: new Date().toISOString() })]);
    const again = await serverRow("nights", second.pk.id as string);
    expect(again.merged_into).toBe(first.pk.id);
    expect(again.deleted_at).not.toBeNull();
  });

  it("brings back a night whose link fails (another person's night, a missing one, one made later), on the server and on a device", async () => {
    const watcher = await newDevice();
    const U2 = uuidv7(), theirs = uuidv7(), [d1, d2, d3] = [nextDate(), nextDate(), nextDate()];
    await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'u2','U2')", [U2]);
    await server.db.admin.query("INSERT INTO nights (id, user_id, date, created_at) VALUES ($1, $2, $3, now() - interval '1 day')", [theirs, U2, d1]);
    const gone = new Date().toISOString();
    const intoTheirs = night({ date: d1, deleted_at: gone, merged_into: theirs });
    const intoNothing = night({ date: d2, deleted_at: gone, merged_into: uuidv7() });
    const madeLater = night({ date: d3, created_at: new Date(Date.now() + 60000).toISOString() });
    const intoLater = night({ date: d3, deleted_at: gone, merged_into: madeLater.pk.id });
    const cases = [intoTheirs, intoNothing, intoLater];
    const ds = cases.map((n) => dream(n.pk.id as string));
    const res = await send([intoTheirs, intoNothing, madeLater, intoLater, ...ds]);
    expect([res.failed, res.mergeFailed]).toEqual([[], 0]);
    expect((await server.db.admin.query("SELECT count(*) AS n FROM dreams WHERE night_id = $1", [theirs])).rows[0].n).toBe(0);
    // (the device also hands the merged night's fields to its survivor, which only a device can, and sends that)
    await pull(watcher); await sync(watcher);
    // each comes back as the live night of its date, its dream visible, the same on the server and on the device
    for (const [i, n] of cases.entries()) {
      for (const e of [server, watcher.eng]) {
        const live = await nightsOn(e, [d1, d2, d3][i]!);
        expect(live.map((v) => [v.id, v.mergedInto])).toEqual([[n.pk.id, null]]);
        expect(((await on(e)("GET", `/nights/${n.pk.id}`)).dreams as Rec[]).map((d) => d.id)).toEqual([ds[i]!.pk.id]);
      }
    }
    // the night made later is the one merged now, by the rule
    expect((await serverRow("nights", madeLater.pk.id as string)).merged_into).toBe(intoLater.pk.id);
    await settled(watcher);
  });

  it("settles the other merged nights when one fails, and the failed one on a later pass", async () => {
    const d = await newDevice();
    const t = Date.now(), iso = (ms: number) => new Date(ms).toISOString();
    const row = (tbl: string, o: Rec): Change => ({ tbl, pk: { id: o.id }, op: "upsert", at: iso(t), row: { created_at: iso(t), updated_at: iso(t), ...o } });
    const [s1, s2, l1, l2, dr1, dr2] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    const [date1, date2] = [nextDate(), nextDate()];
    // two nights and their dreams, here first; then the nights made before them, for the same dates
    await replica.applyRemote(d.eng.db, U, [row("nights", { id: l1, date: date1, created_at: iso(t + 1000) }), row("nights", { id: l2, date: date2, created_at: iso(t + 1000) }),
      row("dreams", { id: dr1, night_id: l1 }), row("dreams", { id: dr2, night_id: l2 })], undefined, KEY);
    await d.eng.db.admin.exec(`CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id = '${dr2}' AND NEW.night_id IS DISTINCT FROM OLD.night_id THEN RAISE EXCEPTION 'no'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER boom BEFORE UPDATE ON dreams FOR EACH ROW EXECUTE FUNCTION boom();`);
    const first = await replica.applyRemote(d.eng.db, U, [row("nights", { id: s1, date: date1 }), row("nights", { id: s2, date: date2 })], undefined, KEY);
    expect(first.mergeFailed).toBe(1);
    const nightOf = async (id: string) => (await d.eng.db.admin.query("SELECT night_id FROM dreams WHERE id = $1", [id])).rows[0].night_id;
    expect([await nightOf(dr1), await nightOf(dr2)]).toEqual([s1, l2]);
    const marked = async () => (await d.eng.db.admin.query("SELECT id FROM nights WHERE merge_pending")).rows.map((r: Rec) => r.id);
    expect(await marked()).toEqual([l2]);
    await d.eng.db.admin.exec("DROP TRIGGER boom ON dreams; DROP FUNCTION boom();");
    // the next pull, even one with nothing new, settles it
    const next = await replica.applyRemote(d.eng.db, U, [], undefined, KEY);
    expect(next.mergeFailed).toBe(0);
    expect(await nightOf(dr2)).toBe(s2);
    expect(await marked()).toEqual([]);
  });

  it("tries a merge that failed on the server again on the next push, and settles it", async () => {
    const date = nextDate();
    const a = await newDevice(), b = await newDevice();
    const na = await on(a.eng)("POST", "/nights", { date, notes: "notes from a" });
    await later();
    const nb = await on(b.eng)("POST", "/nights", { date, notes: "notes from b" });
    const db = await on(b.eng)("POST", "/dreams", { nightId: nb.id, text: "b's dream" });
    await push(b);
    // moving b's dream fails on the server when a's night (made first) arrives
    await server.db.admin.exec(`CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id = '${db.id}' AND NEW.night_id IS DISTINCT FROM OLD.night_id THEN RAISE EXCEPTION 'no'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER boom BEFORE UPDATE ON dreams FOR EACH ROW EXECUTE FUNCTION boom();`);
    const out = await replica.localChanges(a.eng.db, 500, KEY);
    const res = await S()("POST", "/sync/push", { device: a.id, changes: out.changes });
    await replica.markSent(a.eng.db, out.upTo);
    expect([res.failed, res.mergeFailed]).toEqual([[], 1]);
    expect(await serverRow("nights", nb.id)).toMatchObject({ merged_into: na.id, merge_pending: true });
    expect((await serverRow("dreams", db.id)).night_id).toBe(nb.id);
    await server.db.admin.exec("DROP TRIGGER boom ON dreams; DROP FUNCTION boom();");
    // the next push, about anything at all, settles it on the server, and every device hears
    await on(a.eng)("POST", "/goals", { kind: "recall_per_week", target: 3 });
    await push(a);
    expect(await serverRow("nights", nb.id)).toMatchObject({ merged_into: na.id, merge_pending: false });
    expect((await serverRow("dreams", db.id)).night_id).toBe(na.id);
    for (let i = 0; i < 2; i++) { await sync(a); await sync(b); }
    for (const d of [a, b]) {
      expect(((await on(d.eng)("GET", `/nights/${na.id}`)).dreams as Rec[]).map((v) => v.id)).toEqual([db.id]);
      await settled(d);
    }
  });

  it("brings a deleted night back when a dream written offline elsewhere arrives under it", async () => {
    const date = nextDate();
    const a = await newDevice();
    const n = await on(a.eng)("POST", "/nights", { date, notes: "the night" });
    const seen = await on(a.eng)("POST", "/dreams", { nightId: n.id, text: "seen, deleted with the night" });
    await sync(a);
    const b = await newDevice();
    // b goes offline and writes under the night; then a deletes the night (and the dream it saw) and syncs
    const unseen = await on(b.eng)("POST", "/dreams", { nightId: n.id, text: "written on b, offline" });
    await later();
    await on(a.eng)("DELETE", `/nights/${n.id}`);
    await sync(a);
    expect((await serverRow("nights", n.id)).deleted_at).not.toBeNull();
    for (let i = 0; i < 2; i++) { await sync(b); await sync(a); }
    // the night is back, holding only the dream a never saw; the one a deleted stays deleted
    for (const d of [a, b]) {
      expect((await nightsOn(d.eng, date)).map((v) => v.id)).toEqual([n.id]);
      expect(((await on(d.eng)("GET", `/nights/${n.id}`)).dreams as Rec[]).map((v) => [v.id, v.text])).toEqual([[unseen.id, "written on b, offline"]]);
      await settled(d);
    }
    expect((await serverRow("nights", n.id)).deleted_at).toBeNull();
    expect((await serverRow("dreams", seen.id)).deleted_at).not.toBeNull();

    // and a deletion that arrives in pieces is never undone: a's own push split between the night and its dreams
    const date2 = nextDate();
    const n2 = await on(a.eng)("POST", "/nights", { date: date2 });
    const d2 = await on(a.eng)("POST", "/dreams", { nightId: n2.id, text: "deleted with its night" });
    await on(a.eng)("DELETE", `/nights/${n2.id}`);
    const all = await replica.localChanges(a.eng.db, 500, KEY);
    const nightFirst = all.changes.filter((c) => c.tbl === "nights");
    const dreamLive: Change = { ...all.changes.find((c) => c.tbl === "dreams")!, row: { ...all.changes.find((c) => c.tbl === "dreams")!.row, deleted_at: null } };
    // first page: the night deleted and an older, live copy of its dream; second page: the dream's deletion
    await S()("POST", "/sync/push", { device: a.id, changes: [...nightFirst, dreamLive] });
    expect((await serverRow("nights", n2.id)).deleted_at).not.toBeNull();
    await S()("POST", "/sync/push", { device: a.id, changes: all.changes.filter((c) => c.tbl === "dreams") });
    await replica.markSent(a.eng.db, all.upTo);
    expect((await serverRow("nights", n2.id)).deleted_at).not.toBeNull();
    expect((await serverRow("dreams", d2.id)).deleted_at).not.toBeNull();
  });

  it("ends with both texts and a full record when two devices absorb different nights into one survivor", async () => {
    const date = nextDate();
    const s = await newDevice(), x = await newDevice(), y = await newDevice();
    const ns = await on(s.eng)("POST", "/nights", { date, notes: "from s" });
    await later();
    const l1 = await on(x.eng)("POST", "/nights", { date, notes: "from x" });
    await later();
    const l2 = await on(y.eng)("POST", "/nights", { date, notes: "from y" });
    // each hears of the survivor before sending its own night: x merges l1 into it, y merges l2, neither knows the other's
    await push(s); await pull(x); await pull(y);
    await push(x); await push(y);
    for (let i = 0; i < 3; i++) for (const d of [x, y, s]) await sync(d);
    const fp = await nightFingerprint(KEY);
    const want = await Promise.all(["from x", "from y"].map(fp));
    let seen: string | undefined;
    for (const d of [s, x, y]) {
      const n = await nightsOn(d.eng, date);
      expect(n.map((v) => v.id)).toEqual([ns.id]);
      const notes = n[0]!.notes as string;
      expect(notes.startsWith("from s\n\n")).toBe(true);
      expect(notes.split("\n\n").sort()).toEqual(["from s", "from x", "from y"]);
      seen ??= notes;
      expect(notes).toBe(seen);
      const rec = JSON.parse(n[0]!.absorbed);
      expect(Object.keys(rec).sort()).toEqual([l1.id, l2.id].sort());
      expect([rec[l1.id].notes, rec[l2.id].notes]).toEqual(want);
      await settled(d);
    }
    expect(await opens("nights", "notes", (await serverRow("nights", ns.id)).notes, ns.id)).toBe(seen);
  });
});

describe("009_merge_record", () => {
  it("turns the old absorbed flag into the sealed record's column on rows that already exist, keeping the merge", async () => {
    const eng = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
    const q = (sql: string, args: unknown[] = []) => eng.db.admin.query(sql, args).then((r) => r.rows as Rec[]);
    // a database as 008 left it
    await eng.db.admin.exec(`DROP INDEX nights_merged_into; ALTER TABLE nights DROP COLUMN absorbed;
      ALTER TABLE nights ADD COLUMN absorbed boolean NOT NULL DEFAULT false; DELETE FROM schema_migrations WHERE name = '009_merge_record';`);
    const V = uuidv7(), keep = uuidv7(), merged = uuidv7();
    await q("INSERT INTO users (id, username, display_name) VALUES ($1,'v','V')", [V]);
    await q("INSERT INTO nights (id, user_id, date) VALUES ($1, $2, '2026-01-01')", [keep, V]);
    await q("INSERT INTO nights (id, user_id, date, deleted_at, merged_into, absorbed) VALUES ($1, $2, '2026-01-01', now(), $3, true)", [merged, V, keep]);
    expect(await migrate(eng.db)).toEqual(["009_merge_record"]);
    const rows = await q("SELECT id, merged_into, absorbed, deleted_at IS NOT NULL AS gone FROM nights WHERE user_id = $1", [V]);
    expect(rows.sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual([{ id: keep, merged_into: null, absorbed: null, gone: false }, { id: merged, merged_into: keep, absorbed: null, gone: true }].sort((a, b) => (a.id < b.id ? -1 : 1)));
    expect((await q("SELECT data_type FROM information_schema.columns WHERE table_name = 'nights' AND column_name = 'absorbed'"))[0]!.data_type).toBe("text");
    expect(await q("SELECT indexname FROM pg_indexes WHERE tablename = 'nights' AND indexname = 'nights_merged_into'")).toHaveLength(1);
  });
});

describe("a lesson or link deleted on one device while another holds a live duplicate", () => {
  const lesson = (name: string) => async (e: Engine) => ((await on(e)("GET", "/course")) as Rec[]).filter((l) => l.lessonId === name);

  it("the deletion wins when it is newer than the duplicate, in either push order", async () => {
    for (const [name, deleterFirst] of [["del-1", true], ["del-2", false]] as const) {
      const a = await newDevice(), b = await newDevice();
      await on(b.eng)("PUT", `/course/${name}`, { answers: "b's copy" });
      await later();
      await on(a.eng)("PUT", `/course/${name}`, { answers: "a's copy" });
      await later();
      await on(a.eng)("DELETE", `/course/${name}`);
      if (deleterFirst) { await sync(a); await sync(b); await sync(a); } else { await sync(b); await sync(a); await sync(b); }
      for (const e of [a.eng, b.eng, server]) expect(await lesson(name)(e)).toEqual([]);
      for (const x of [a, b]) await settled(x);
    }
  });

  it("a duplicate changed after the deletion stays", async () => {
    for (const [name, deleterFirst] of [["del-3", true], ["del-4", false]] as const) {
      const a = await newDevice(), b = await newDevice();
      await on(a.eng)("PUT", `/course/${name}`, { answers: "a's copy" });
      await later();
      await on(a.eng)("DELETE", `/course/${name}`);
      await later();
      const kept = await on(b.eng)("PUT", `/course/${name}`, { answers: "b's later copy" });
      if (deleterFirst) { await sync(a); await sync(b); await sync(a); } else { await sync(b); await sync(a); await sync(b); }
      for (const e of [a.eng, b.eng, server]) expect((await lesson(name)(e)).map((l) => l.id)).toEqual([kept.id]);
    }
  });

  it("settles a link the same way", async () => {
    const a = await newDevice();
    const night = await on(a.eng)("POST", "/nights", { date: "2026-07-05" });
    const dream = await on(a.eng)("POST", "/dreams", { nightId: night.id, text: "a dream" });
    const element = await on(a.eng)("POST", "/elements", { name: "a cat" });
    await sync(a);
    const b = await newDevice();
    await on(b.eng)("POST", `/dreams/${dream.id}/elements`, { elementId: element.id, span: "b's link" });
    await later();
    await on(a.eng)("POST", `/dreams/${dream.id}/elements`, { elementId: element.id, span: "a's link" });
    await later();
    await on(a.eng)("DELETE", `/dreams/${dream.id}/elements/${element.id}`);
    await sync(b); await sync(a); await sync(b);
    for (const e of [a.eng, b.eng, server]) expect((await on(e)("GET", `/dreams/${dream.id}`)).elements).toEqual([]);
  });
});

describe("two devices that write a day note for the same date offline", () => {
  const notes = (date: string) => async (e: Engine) => ((await on(e)("GET", "/day-notes")) as Rec[]).filter((n) => n.date === date);

  it("keep one note per date everywhere, with both texts joined on the devices, in either push order", async () => {
    for (const [date, aFirst] of [["2026-08-01", true], ["2026-08-02", false]] as const) {
      const a = await newDevice(), b = await newDevice();
      const na = await on(a.eng)("POST", "/day-notes", { id: uuidv7(), date, text: "Lunch with Sam" });
      await later();
      const nb = await on(b.eng)("POST", "/day-notes", { id: uuidv7(), date, text: "Walked by the river" });
      // the device that joins the texts sends the joined note on its next round, and the other takes it on its own
      const [x, y] = aFirst ? [a, b] : [b, a];
      for (let i = 0; i < 3; i++) { await sync(x); await sync(y); }
      // b's is newer, so it stays (under its own id); a's text is joined into it
      for (const e of [a.eng, b.eng, server]) expect((await notes(date)(e)).map((n) => n.id), date).toEqual([nb.id]);
      for (const d of [a, b]) {
        expect((await notes(date)(d.eng))[0]!.text, date).toBe("Walked by the river\n\nLunch with Sam");
        await settled(d);
      }
      // the server never opened anything: what it keeps is sealed, each text under its own row
      const raw = (await server.db.admin.query("SELECT id, text, deleted_at, merged_into FROM day_notes WHERE date = $1 ORDER BY id", [date])).rows;
      expect(raw).toHaveLength(2);
      for (const r of raw) expect(isSealed(r.text)).toBe(true);
      expect(raw.find((r: any) => r.id === na.id)).toMatchObject({ merged_into: null });
      expect(raw.find((r: any) => r.id === na.id)!.deleted_at).not.toBeNull();
    }
  });

  it("refuses a second live note for a date through the API", async () => {
    const date = "2026-08-03", d = on((await newDevice()).eng);
    const first = await d("POST", "/day-notes", { id: uuidv7(), date, text: "x" });
    await expect(d("POST", "/day-notes", { id: uuidv7(), date, text: "y" })).rejects.toMatchObject({ status: 409 });
    // the same note sent again is not a second one
    expect((await d("POST", "/day-notes", { id: first.id, date, text: "x" })).id).toBe(first.id);
    const other = await d("POST", "/day-notes", { id: uuidv7(), date: "2026-08-04", text: "z" });
    await expect(d("PUT", `/day-notes/${other.id}`, { date })).rejects.toMatchObject({ status: 409 });
  });

});

describe("practice items", () => {
  it("takes habit and memory-target ids only from their fixed lists", async () => {
    const date = "2026-08-05";
    for (const item of ["habit:journal", "habit:meditation", "habit:yoga-2", "pm:pet", "pm-hit:mirror", "pm-miss:cup", "lesson-1:0"])
      expect((await S()("POST", "/practice", { id: uuidv7(), date, item, done: true })).item).toBe(item);
    for (const item of ["pm:my secret", "pm-hit:", "pm-miss:Pet", "habit:anything", "habit:"])
      await expect(S()("POST", "/practice", { id: uuidv7(), date, item, done: true }), item).rejects.toMatchObject({ status: 400 });
    const res = await S()("POST", "/sync/push", { device: "t", changes: [{ tbl: "practice_log", op: "upsert", pk: { id: uuidv7() }, at: new Date().toISOString(),
      row: { id: uuidv7(), date, item: "pm:typed text", done: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } }] });
    expect(res.failed).toHaveLength(1);
  });
});
