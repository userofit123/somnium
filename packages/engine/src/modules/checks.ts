// Reality checks: each one logged with its kind and outcome, prompted by a reminder or not (PLAN.md §5, §6.4).
import { CHECK_KINDS, CHECK_OUTCOMES, type RealityCheck } from "@somnium/shared";
import type { Router } from "../router";
import { id, intOrNull, bool, isoTime } from "../util";
import { clientId, columns, sealed, enumOf, listLive, getLive, insertRow, updateRow, removeRow, type Fields } from "./rows";

const CHECK: Fields = {
  at: (v) => isoTime(v, new Date().toISOString()),
  kind: enumOf(CHECK_KINDS, "other"),
  outcome: enumOf(CHECK_OUTCOMES, "awake"),
  prompted: (v) => bool(v),
  note: sealed,
};

export function checkRoutes(r: Router) {
  // newest first; from/to are instants (ISO), limit at most 2000, or all=1 for every one (Insights sums them all)
  r.get("/reality-checks", async ({ q }, _p, _b, qs) => {
    const w: string[] = [], params: unknown[] = [];
    if (qs.from) { params.push(isoTime(qs.from)); w.push(`at >= $${params.length}`); }
    if (qs.to) { params.push(isoTime(qs.to)); w.push(`at <= $${params.length}`); }
    return listLive<RealityCheck>(q, "reality_checks", w.join(" AND "), params, "at DESC", qs.all === "1" ? 1_000_000 : intOrNull(qs.limit, 1, 2000) ?? 200);
  });
  r.get("/reality-checks/:id", async ({ q }, p) => getLive<RealityCheck>(q, "reality_checks", id(p.id), "reality check"));
  r.post("/reality-checks", async (ctx, _p, b) => insertRow<RealityCheck>(ctx, "reality_checks", "checks", { ...columns(CHECK, b, true), ...clientId(b) }));
  r.put("/reality-checks/:id", async (ctx, p, b) => updateRow<RealityCheck>(ctx, "reality_checks", "checks", id(p.id), columns(CHECK, b, false), "reality check"));
  r.del("/reality-checks/:id", async (ctx, p) => { await removeRow(ctx, "reality_checks", "checks", id(p.id), "reality check"); return { ok: true }; });
}
