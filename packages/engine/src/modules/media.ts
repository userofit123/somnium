// A dream's files (PLAN.md §6.2, LDJ-20): the list of its photos, sketches and voice notes, the text read from a photo
// (sealed, like the dream's own), and removing one. The file itself goes up and comes back through the server's
// /api/media (apps/server/src/app.ts), sealed on the device; nothing here ever reads or returns it.
import type { Media } from "@somnium/shared";
import type { Router } from "../router";
import { id, camels } from "../util";
import { columns, sealed, updateRow, removeRow, type Fields } from "./rows";

const MEDIA: Fields = { ocr_text: sealed };
// never `data` (a local account's whole file) or `path` (where the server keeps it)
const COLS = "id, user_id, dream_id, kind, mime, size, duration, ocr_text, created_at, updated_at";
const shown = <T extends Record<string, unknown>>(row: T) => { const { data: _d, path: _p, ...rest } = row as Record<string, unknown>; return rest as T; };

export function mediaRoutes(r: Router) {
  // a dream's files, oldest first (the order they were added in)
  r.get("/media", async ({ q }, _p, _b, qs) => {
    const dreamId = id(qs.dreamId, "dream");
    const { rows } = await q.query<Record<string, unknown>>(`SELECT ${COLS} FROM media WHERE deleted_at IS NULL AND dream_id = $1 ORDER BY created_at LIMIT 200`, [dreamId]);
    return camels<Media>(rows);
  });
  // the text read from a photo, after the person has checked it (sealed by the device)
  r.put("/media/:id", async (ctx, p, b) => shown(await updateRow<Media & Record<string, unknown>>(ctx, "media", "dreams", id(p.id), columns(MEDIA, b, false), "file")));
  r.del("/media/:id", async (ctx, p) => { await removeRow(ctx, "media", "dreams", id(p.id), "file"); return { ok: true }; });
}
