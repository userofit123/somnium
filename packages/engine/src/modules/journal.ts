// The journal: nights, the dreams of a night, the person's elements (and dream signs) and the links between dreams
// and elements. Search and analysis come later (PLAN.md §7); this is the plain reading and writing.
import { WBTB_MODE_LOG, BECAME_LUCID_HOW, WAKE_METHODS, ELEMENT_KINDS, SIGN_CATEGORIES, ELEMENT_SOURCES, type Night, type Dream, type Element, type DreamElement } from "@somnium/shared";
import type { Router } from "../router";
import { id, str, intOrNull, numOrNull, bool, dateStr, visible, camel, camels } from "../util";
import { clientId, refuseOtherRow, columns, sealed, timeOrNull, clockOrNull, sealedMinutes, idList, enumOrNull, enumOf, required, listLive, getLive, insertRow, updateRow, removeRow, removeWhere, type Fields } from "./rows";
import { conflict, notFound } from "../errors";

const NIGHT: Fields = {
  date: required(dateStr, "date"),
  bedtime: timeOrNull, wake_time: timeOrNull,
  sleep_quality: (v) => intOrNull(v, 1, 5),
  wbtb_used: (v) => bool(v), wbtb_wake_at: timeOrNull, wbtb_minutes_awake: (v) => intOrNull(v, 0, 600),
  wbtb_mode: enumOrNull(WBTB_MODE_LOG), minutes_to_sleep: sealedMinutes(0, 600),
  nap: (v) => bool(v), substances: sealed, caffeine_after: clockOrNull, alcohol: (v) => bool(v), notes: sealed,
  techniques_planned: idList, techniques_done: idList, intention: sealed, no_recall: (v) => bool(v),
};
const DREAM: Fields = {
  position: (v) => intOrNull(v, 0, 100) ?? 0,
  title: sealed, text: sealed,
  lucid: (v) => bool(v), lucidity_level: (v) => intOrNull(v, 0, 5) ?? 0, awareness: (v) => intOrNull(v, 0, 4),
  control: (v) => intOrNull(v, 0, 5), vividness: (v) => intOrNull(v, 1, 5), recall_clarity: (v) => intOrNull(v, 1, 5),
  emotion_overall: (v) => intOrNull(v, -2, 2), duration_est: (v) => intOrNull(v, 0, 600),
  nightmare: (v) => bool(v), recurring: (v) => bool(v), false_awakening: (v) => bool(v), sleep_paralysis: (v) => bool(v),
  became_lucid_how: enumOrNull(BECAME_LUCID_HOW), lucid_trigger: sealed, wake_method: enumOrNull(WAKE_METHODS), favourite: (v) => bool(v),
  dismissed: sealed,
};
const ELEMENT: Fields = {
  kind: enumOf(ELEMENT_KINDS, "theme"),
  name: sealed, aliases: sealed, colour: (v) => (v == null || v === "" ? null : str(v, 20)), note: sealed,
  is_dream_sign: (v) => bool(v), sign_category: enumOrNull(SIGN_CATEGORIES), confirmed: (v) => bool(v),
};
const LINK: Fields = {
  source: enumOf(ELEMENT_SOURCES, "manual"), confidence: (v) => numOrNull(v, 0, 1), span: sealed,
};

/** from/to (YYYY-MM-DD, both optional) on a date column, as SQL and params. */
function range(col: string, qs: Record<string, string>, params: unknown[] = []) {
  const w: string[] = [];
  const from = dateStr(qs.from), to = dateStr(qs.to);
  if (from) { params.push(from); w.push(`${col} >= $${params.length}`); }
  if (to) { params.push(to); w.push(`${col} <= $${params.length}`); }
  return { where: w.join(" AND "), params };
}

export function journalRoutes(r: Router) {
  // nights, newest first, with how many dreams (and lucid ones) each has: what the rates (shared rates.ts) need
  r.get("/nights", async ({ q }, _p, _b, qs) => {
    const { where, params } = range("n.date", qs);
    const { rows } = await q.query<Record<string, unknown>>(
      `SELECT n.*, (SELECT count(*) FROM dreams d WHERE d.night_id = n.id AND d.deleted_at IS NULL)::int AS dream_count,
              (SELECT count(*) FROM dreams d WHERE d.night_id = n.id AND d.deleted_at IS NULL AND d.lucid)::int AS lucid_count
       FROM nights n WHERE n.deleted_at IS NULL${where ? ` AND ${where}` : ""} ORDER BY n.date DESC${qs.all === "1" ? "" : " LIMIT 1000"}`, params);
    return rows.map((x) => ({ ...camel<Night>(x), dreamCount: Number(x.dream_count), lucidCount: Number(x.lucid_count) }));
  });
  r.get("/nights/:id", async ({ q }, p) => {
    const night = await getLive<Night>(q, "nights", id(p.id), "night");
    return { ...night, dreams: await listLive<Dream>(q, "dreams", "night_id = $1", [night.id], "position, created_at") };
  });
  r.post("/nights", async (ctx, _p, b) => {
    // one live night per date (index nights_user_date_live; a nap is its own row and may share the date)
    try { return await insertRow<Night>(ctx, "nights", "nights", { ...columns(NIGHT, b, true), ...clientId(b) }); }
    catch (e) { if (/nights_user_date_live/.test(String((e as Error).message))) throw conflict("There is already a night for that date"); throw e; }
  });
  r.put("/nights/:id", async (ctx, p, b) => updateRow<Night>(ctx, "nights", "nights", id(p.id), columns(NIGHT, b, false), "night"));
  // removing a night takes its dreams with it, and each dream its links and media (the same cascade as DELETE /dreams/:id)
  r.del("/nights/:id", async (ctx, p) => {
    const nightId = id(p.id);
    await removeRow(ctx, "nights", "nights", nightId, "night");
    const dreams = (await ctx.q.query<{ id: string }>("SELECT id FROM dreams WHERE night_id = $1 AND deleted_at IS NULL", [nightId])).rows.map((d) => d.id);
    if (dreams.length) {
      await removeWhere(ctx.q, "dream_elements", "dream_id = ANY($1::uuid[])", [dreams]);
      await removeWhere(ctx.q, "media", "dream_id = ANY($1::uuid[])", [dreams]);
      await removeWhere(ctx.q, "dreams", "night_id = $1", [nightId]);
      ctx.changed("dreams", "elements");
    }
    return { ok: true };
  });

  r.get("/dreams", async ({ q }, _p, _b, qs) => {
    const w: string[] = [], params: unknown[] = [];
    if (qs.nightId) { params.push(id(qs.nightId, "night")); w.push(`d.night_id = $${params.length}`); }
    if (qs.lucid === "1" || qs.lucid === "true") w.push("d.lucid");
    const rg = range("n.date", qs, params);
    if (rg.where) w.push(rg.where);
    const { rows } = await q.query(
      `SELECT d.*, n.date FROM dreams d JOIN nights n ON n.id = d.night_id WHERE d.deleted_at IS NULL AND n.deleted_at IS NULL
       ${w.length ? "AND " + w.join(" AND ") : ""} ORDER BY n.date DESC, d.position, d.created_at LIMIT ${Math.min(intOrNull(qs.limit, 1, 2000) ?? 200, 2000)}`, params);
    return camels(rows);
  });
  // Every live dream's plain facts, with no limit: what Signs and Insights sum over (PLAN.md §6.3, §6.5). Only columns
  // that are never sealed, so the list stays light however long the journal grows and needs no key to open.
  r.get("/dream-facts", async ({ q }) => {
    const { rows } = await q.query(
      `SELECT d.id, d.night_id, n.date, n.nap, d.lucid, d.lucidity_level, d.awareness, d.emotion_overall, d.nightmare, d.false_awakening,
              d.sleep_paralysis, d.became_lucid_how, d.favourite
       FROM dreams d JOIN nights n ON n.id = d.night_id WHERE d.deleted_at IS NULL AND n.deleted_at IS NULL
       ORDER BY n.date DESC, d.position, d.created_at`);
    return camels(rows);
  });
  r.get("/dreams/:id", async ({ q }, p) => {
    const dream = await getLive<Dream>(q, "dreams", id(p.id), "dream");
    return { ...dream, elements: await listLive<DreamElement>(q, "dream_elements", "dream_id = $1", [dream.id], "created_at") };
  });
  r.post("/dreams", async (ctx, _p, b) => {
    const nightId = id(b.nightId, "night");
    await visible(ctx.q, "nights", nightId, "night");
    return insertRow<Dream>(ctx, "dreams", "dreams", { night_id: nightId, ...columns(DREAM, b, true), ...clientId(b) });
  });
  r.put("/dreams/:id", async (ctx, p, b) => {
    const cols = columns(DREAM, b, false);
    if ("nightId" in b) { cols.night_id = id(b.nightId, "night"); await visible(ctx.q, "nights", cols.night_id as string, "night"); }
    return updateRow<Dream>(ctx, "dreams", "dreams", id(p.id), cols, "dream");
  });
  r.del("/dreams/:id", async (ctx, p) => {
    await removeRow(ctx, "dreams", "dreams", id(p.id), "dream");
    await removeWhere(ctx.q, "dream_elements", "dream_id = $1", [p.id]);
    await removeWhere(ctx.q, "media", "dream_id = $1", [p.id]);
    return { ok: true };
  });

  // Undo for a delete: brings the dream back with the links and media that went with it (marked in the same moment, so
  // the ones the person had removed earlier stay removed). Its night must still be there; elements that were removed
  // since are not brought back as links. updated_at moves on, so on every device the restore wins over the delete.
  r.post("/dreams/:id/restore", async (ctx, p) => {
    const dreamId = id(p.id, "dream");
    const gone = (await ctx.q.query<{ deleted_at: Date | string; night_id: string }>("SELECT deleted_at, night_id FROM dreams WHERE id = $1 AND deleted_at IS NOT NULL", [dreamId])).rows[0];
    if (!gone) {
      // already back (a second tap, another device): fine; never existed: 404
      const live = (await ctx.q.query("SELECT 1 FROM dreams WHERE id = $1", [dreamId])).rows.length;
      if (!live) throw notFound("Unknown dream");
      return getLive<Dream>(ctx.q, "dreams", dreamId, "dream");
    }
    const night = (await ctx.q.query("SELECT 1 FROM nights WHERE id = $1 AND deleted_at IS NULL", [gone.night_id])).rows.length;
    if (!night) throw conflict("This dream's night was deleted too, so it can't be brought back");
    const at = gone.deleted_at;
    await ctx.q.query("UPDATE dream_elements SET deleted_at = NULL, updated_at = now() WHERE dream_id = $1 AND deleted_at >= $2 AND element_id IN (SELECT id FROM elements WHERE deleted_at IS NULL)", [dreamId, at]);
    await ctx.q.query("UPDATE media SET deleted_at = NULL, updated_at = now() WHERE dream_id = $1 AND deleted_at >= $2", [dreamId, at]);
    const row = (await ctx.q.query<Record<string, unknown>>("UPDATE dreams SET deleted_at = NULL, updated_at = now() WHERE id = $1 RETURNING *", [dreamId])).rows[0]!;
    // there is no media topic (packages/shared/src/live.ts): a dream's photos are read with the dream, so "dreams"
    // already moves every screen that shows the ones that came back
    ctx.changed("dreams", "elements");
    return camel<Dream>(row);
  });

  r.get("/elements", async ({ q }, _p, _b, qs) => {
    const w: string[] = [], params: unknown[] = [];
    if (qs.kind) { params.push(enumOf(ELEMENT_KINDS, "theme")(qs.kind)); w.push(`kind = $${params.length}`); }
    if (qs.signs === "1" || qs.signs === "true") w.push("is_dream_sign");
    return listLive<Element>(q, "elements", w.join(" AND "), params, "created_at", 2000);
  });
  r.get("/elements/:id", async ({ q }, p) => {
    const el = await getLive<Element>(q, "elements", id(p.id), "element");
    return { ...el, dreams: await listLive<DreamElement>(q, "dream_elements", "element_id = $1", [el.id], "created_at") };
  });
  r.post("/elements", async (ctx, _p, b) => insertRow<Element>(ctx, "elements", "elements", { ...columns(ELEMENT, b, true), ...clientId(b) }));
  r.put("/elements/:id", async (ctx, p, b) => updateRow<Element>(ctx, "elements", "elements", id(p.id), columns(ELEMENT, b, false), "element"));
  r.del("/elements/:id", async (ctx, p) => {
    await removeRow(ctx, "elements", "elements", id(p.id), "element");
    await removeWhere(ctx.q, "dream_elements", "element_id = $1", [p.id]);
    ctx.changed("dreams");
    return { ok: true };
  });

  // every live link at once: what the Journal needs for element counts and searching by element on the device
  r.get("/dream-elements", async ({ q }) => listLive<DreamElement>(q, "dream_elements", "", [], "created_at", 20000));

  // a link between a dream and an element; linking again updates the one there (source, confidence, where in the text)
  r.post("/dreams/:id/elements", async (ctx, p, b) => {
    const dreamId = id(p.id, "dream"), elementId = id(b.elementId, "element");
    await visible(ctx.q, "dreams", dreamId, "dream");
    await visible(ctx.q, "elements", elementId, "element");
    const cur = (await ctx.q.query("SELECT id FROM dream_elements WHERE dream_id = $1 AND element_id = $2 AND deleted_at IS NULL", [dreamId, elementId])).rows[0];
    // linking again changes only what it names: a link made again without a span keeps the span it has
    const cols = columns(LINK, b, !cur);
    if (cur) refuseOtherRow(ctx, "dream_elements", b, cols, cur.id);
    const out = cur
      ? await updateRow<DreamElement>(ctx, "dream_elements", "dreams", cur.id, cols)
      : await insertRow<DreamElement>(ctx, "dream_elements", "dreams", { dream_id: dreamId, element_id: elementId, ...cols, ...clientId(b) });
    ctx.changed("elements");
    return out;
  });
  r.del("/dreams/:id/elements/:elementId", async (ctx, p) => {
    const n = await removeWhere(ctx.q, "dream_elements", "dream_id = $1 AND element_id = $2", [id(p.id, "dream"), id(p.elementId, "element")]);
    if (!n) throw notFound("Unknown link");
    ctx.changed("dreams", "elements");
    return { ok: true };
  });
}

