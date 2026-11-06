// The list of changes made without a connection on the direct path (apps/web/src/api/outbox.ts). Every tab of the
// app shares one list per account in this device's storage, so the list there is the truth: a tab reads it again
// before each change to it, and removes what it sent by id, never by position (another tab may have added to it or
// sent from it meanwhile). Without that, a tab closed with a change queued left it there, unseen by the tab still
// open, and two tabs queueing at once each saved their own list over the other's.

export interface OutboxItem { id: string; method: "post" | "put" | "del"; path: string; body?: unknown; at: number }

const METHODS = new Set(["post", "put", "del"]);

/** The list as stored. One saved before items had ids gets one made from what it is, the same in every tab. */
export function outboxItems(raw: unknown): OutboxItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((i) => i && typeof i === "object" && METHODS.has(i.method) && typeof i.path === "string")
    .map((i) => ({ ...i, at: Number(i.at) || 0, id: typeof i.id === "string" && i.id ? i.id : `${Number(i.at) || 0}:${i.method}:${i.path}` }));
}

/** The list once the item with this id is sent (or given up): the rest stays as it is now, in its order. */
export const withoutSent = (list: readonly OutboxItem[], id: string): OutboxItem[] => list.filter((i) => i.id !== id);
