// What the dream page writes (PLAN.md §6.2, LDJ-15): confirming or rejecting a found element, marking a dream sign,
// and bringing back a deleted dream. All through the ordinary routes (sealed like every other write); each one reads
// the row again just before changing it, so another device's change meanwhile is kept.
import { parseDismissed, type Dream, type Suggestion } from "@somnium/shared";
import { api, ApiError } from "./client";
import { invalidate } from "./live";
import { needsServer, uuidv7 } from "./journal";

const done = () => invalidate(["journal", "home"]);

/** Confirms a found element for one dream: links the person's own element, or makes it first. Where it was found is kept. */
export async function confirmSuggestion(dreamId: string, s: Suggestion) {
  const meta = { source: "detected", confidence: s.confidence, span: JSON.stringify(s.spans) };
  await needsServer(async () => {
    let id = s.existingElementId;
    if (!id) {
      id = uuidv7();
      await api.post("/elements", { id, kind: s.kind, name: s.name, confirmed: true, ...(s.type === "sign" ? { isDreamSign: true, signCategory: s.signCategory ?? null } : {}) });
    }
    await api.post(`/dreams/${dreamId}/elements`, { elementId: id, ...meta });
  });
  done();
}

/** Not this one, for this dream: the dream is read again first, so a dismissal made elsewhere meanwhile is kept. */
export async function rejectSuggestion(dreamId: string, key: string) {
  await needsServer(async () => {
    const d = await api.get<Dream>(`/dreams/${dreamId}`);
    const list = parseDismissed(d.dismissed);
    if (!list.includes(key)) await api.put(`/dreams/${dreamId}`, { dismissed: JSON.stringify([...list, key]) });
  });
  done();
}

export async function setDreamSign(elementId: string, on: boolean) {
  await needsServer(() => api.put(`/elements/${elementId}`, { isDreamSign: on }));
  done();
}

/** Undo of a delete: the dream comes back with its links (the engine route; it syncs like any change). */
export async function restoreDream(dreamId: string) {
  try { await needsServer(() => api.post(`/dreams/${dreamId}/restore`, {})); }
  catch (e) { if (e instanceof ApiError && e.status === 409) throw new Error("Its night was deleted too, so this dream can't be brought back"); throw e; }
  done();
}
