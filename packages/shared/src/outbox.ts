// The list of changes made without a connection on the direct path (apps/web/src/api/outbox.ts). Every tab of the
// app shares one list per account in this device's storage, so the list there is the truth: a tab reads it again
// before each change to it, and removes what it sent by id, never by position (another tab may have added to it or
// sent from it meanwhile). Without that, a tab closed with a change queued left it there, unseen by the tab still
// open, and two tabs queueing at once each saved their own list over the other's.
//
// The sending itself lives here too, with storage, the network and the sealed-column check handed in, so it can be
// tested without a browser. Three rules it keeps:
// - Nothing sealed is ever queued in the clear (PLAN.md §4.1): the list sits in this browser's storage, readable by
//   every tab, and outlives the lock. A body carrying a sealed column is refused before it is sent or queued; such a
//   change keeps its value sealed elsewhere (apps/web/src/api/checks.ts, the reality check note).
// - A create carries its own row id (the item's id), so sending it again after an answer that never arrived hits the
//   same row; the server answers a repeat of the same create as a success (packages/engine/src/modules/rows.ts).
// - One tab sends at a time: navigator.locks where there is one, otherwise a lease in storage that runs out on its
//   own, so a tab closed mid-send doesn't stop the others for good.

export interface OutboxItem { id: string; method: "post" | "put" | "del"; path: string; body?: unknown; at: number }

const METHODS = new Set(["post", "put", "del"]);

/** The list as stored. One saved before items had ids gets one made from what it is and where it stands in the
 *  stored list, the same in every tab (two changes to one path in the same millisecond still differ). */
export function outboxItems(raw: unknown): OutboxItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((i, n) => ({ i, n })).filter(({ i }) => i && typeof i === "object" && METHODS.has(i.method) && typeof i.path === "string")
    .map(({ i, n }) => ({ ...i, at: Number(i.at) || 0, id: typeof i.id === "string" && i.id ? i.id : `${Number(i.at) || 0}:${i.method}:${i.path}:${n}` }));
}

/** The list once the item with this id is sent (or given up): the rest stays as it is now, in its order. */
export const withoutSent = (list: readonly OutboxItem[], id: string): OutboxItem[] => list.filter((i) => i.id !== id);

/** A create's body with its row id: the one it has, or the item's. Anything else is left as it is. */
export function withRowId(method: OutboxItem["method"], body: unknown, id: string): unknown {
  if (method !== "post" || !body || typeof body !== "object" || Array.isArray(body)) return body;
  const b = body as Record<string, unknown>;
  return typeof b.id === "string" && b.id ? b : { ...b, id };
}

export interface OutboxStorage { read(key: string): unknown; write(key: string, value: unknown): void }
interface Locks { request(name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>): Promise<unknown> }

export interface OutboxDeps {
  /** Where the signed-in account's list is kept, or null while nobody is signed in. */
  key: () => string | null;
  storage: OutboxStorage;
  request: (method: OutboxItem["method"], path: string, body: unknown) => Promise<unknown>;
  /** The change can't go yet (no connection, the key closed): it waits. */
  mustWait: (e: unknown) => boolean;
  /** Throws when the body carries a sealed column in the clear. */
  refuseSealed: (method: OutboxItem["method"], path: string, body: unknown) => void;
  newId: () => string;
  /** A queued change the server refused: it is dropped, and this says so. */
  onRefused?: (e: unknown, item: OutboxItem) => void;
  /** The list this tab holds changed. */
  onChange?: (list: OutboxItem[]) => void;
  /** Everything waiting went out. */
  onEmptied?: () => void;
  locks?: () => Locks | undefined;
  now?: () => number;
  /** This tab, for the lease. */
  tab?: string;
}

/** How long a lease holds without being renewed: longer than one request may take, short enough not to strand a list. */
export const LEASE_MS = 30_000;
// its own prefix, so nothing that reads the lists by their prefix (leftByOthers) takes it for one
export const leaseKey = (key: string) => `somniumOutboxLease|${key}`;

export function createOutbox(d: OutboxDeps) {
  const now = d.now ?? Date.now;
  const tab = d.tab ?? d.newId();
  let list: OutboxItem[] = [];
  let flushing = false;
  const set = (l: OutboxItem[]) => { list = l; d.onChange?.(l); };
  const reread = () => { const k = d.key(); set(k ? outboxItems(d.storage.read(k)) : []); };
  const save = () => { const k = d.key(); if (k) d.storage.write(k, list); };

  function queue(method: OutboxItem["method"], path: string, body: unknown, id: string) {
    d.refuseSealed(method, path, body); // checked again where it would be written, whoever calls
    reread();
    if (list.some((x) => x.id === id)) return;
    set([...list, { id, method, path, body, at: now() }]);
    save();
  }

  // the lease: taken when free, run out, or already this tab's; read back so the later of two writers wins alone
  function takeLease(k: string): boolean {
    const l = d.storage.read(leaseKey(k)) as { tab?: string; until?: number } | null;
    if (l && l.tab !== tab && Number(l.until) > now()) return false;
    d.storage.write(leaseKey(k), { tab, until: now() + LEASE_MS });
    return (d.storage.read(leaseKey(k)) as { tab?: string } | null)?.tab === tab;
  }
  function dropLease(k: string) {
    if ((d.storage.read(leaseKey(k)) as { tab?: string } | null)?.tab === tab) d.storage.write(leaseKey(k), null);
  }

  async function sendAll(mine: string, renew: () => boolean) {
    reread();
    while (list.length) {
      if (!renew()) break;
      const it = list[0]!;
      try { await d.request(it.method, it.path, it.body); }
      catch (e) {
        if (d.mustWait(e)) break;
        // refused: dropped rather than blocking the rest, and said (onRefused), never lost silently
        d.onRefused?.(e, it);
      }
      // the list may have been cleared or changed hands while this was on its way
      if (d.key() !== mine) break;
      reread();
      if (!list.some((x) => x.id === it.id)) break; // cleared (signed out) meanwhile
      set(withoutSent(list, it.id)); save();
    }
  }

  return {
    get list() { return list; },
    reread,
    /** Sends a change now, or keeps it for later when the server can't be reached. Errors from the server itself are
     *  thrown, and so is a body with a sealed column in the clear: that is never sent from here or queued. */
    async send<T = unknown>(method: OutboxItem["method"], path: string, body?: unknown): Promise<T | null> {
      d.refuseSealed(method, path, body);
      const id = d.newId();
      const b = withRowId(method, body, id);
      // a create's item is known by its row's id: queued twice, it is still one change
      const itemId = method === "post" && b && typeof b === "object" && typeof (b as { id?: unknown }).id === "string" ? (b as { id: string }).id : id;
      reread();
      if (list.length) { queue(method, path, b, itemId); void this.flush(); return null; }
      try { return (await d.request(method, path, b)) as T; }
      catch (e) {
        if (d.mustWait(e)) { queue(method, path, b, itemId); return null; }
        throw e;
      }
    },
    async flush() {
      reread();
      const mine = d.key();
      if (flushing || !list.length || !mine) return;
      flushing = true;
      try {
        // one tab sends at a time: two sending the same list would replay each change twice
        const locks = d.locks?.();
        if (locks) await locks.request(`somniumOutboxSend:${mine}`, { ifAvailable: true }, async (lock) => { if (lock && mine === d.key()) await sendAll(mine, () => true); });
        else if (takeLease(mine)) {
          try { await sendAll(mine, () => takeLease(mine)); } finally { dropLease(mine); }
        }
        if (!list.length) d.onEmptied?.();
      } finally { flushing = false; }
    },
    get flushing() { return flushing; },
    /** Signing out: what was queued goes. */
    clear() { set([]); save(); },
  };
}
