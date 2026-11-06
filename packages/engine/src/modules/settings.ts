// The signed-in person and their settings.
import { withDefaults, type Settings } from "@somnium/shared";
import type { Router } from "../router";
import type { Sql } from "../db";
import { str } from "../util";
import { bad } from "../errors";

export async function getSettings(q: Sql, userId: string): Promise<Settings> {
  const r = (await q.query<{ data: unknown }>("SELECT data FROM user_settings WHERE user_id = $1", [userId])).rows[0];
  return withDefaults(r?.data ?? {});
}

export function settingsRoutes(r: Router) {
  r.get("/me", async ({ q, userId, mode }) => {
    const u = (await q.query("SELECT id, username, display_name, email, role FROM users WHERE id = $1", [userId])).rows[0];
    return { user: { id: u.id, username: u.username, displayName: u.display_name, email: u.email, role: u.role, mode }, settings: await getSettings(q, userId) };
  });
  r.put("/me", async (ctx, _p, b) => {
    await ctx.q.query("UPDATE users SET display_name = $2, email = $3 WHERE id = $1", [ctx.userId, str(b.displayName, 80), b.email ? str(b.email, 200) : null]);
    ctx.changed("settings");
    return { ok: true };
  });
  // a partial update: { firstDay: 0 } changes just that, keeping everything else
  r.put("/settings", async (ctx, _p, b) => {
    if (!b || typeof b !== "object" || Array.isArray(b)) throw bad("Expected settings");
    if (JSON.stringify(b).length > 50000) throw bad("Too large");
    const cur = await getSettings(ctx.q, ctx.userId);
    const next = withDefaults(mergeDeep(cur, b));
    await ctx.q.query(
      `INSERT INTO user_settings (user_id, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = now()`, [ctx.userId, JSON.stringify(next)]);
    ctx.changed("settings");
    return next;
  });
}

function mergeDeep(a: any, b: any): any {
  if (Array.isArray(b) || b === null || typeof b !== "object") return b;
  const o = { ...(a && typeof a === "object" && !Array.isArray(a) ? a : {}) };
  for (const k of Object.keys(b)) o[k] = mergeDeep(o[k], b[k]);
  return o;
}
