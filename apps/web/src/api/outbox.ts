// Changes made without a connection wait here, on the device, and are sent in order when the
// connection is back (PLAN.md §2.2). Each one is replayed exactly once; the screen already shows it.
// The sending lives in packages/shared/src/outbox.ts (tested there and in packages/engine/test/outbox.test.ts); this
// is its place in the app: whose list it is, storage, the network, and what the screens see.
import { ref } from "vue";
import { api, ApiError } from "./client";
import { readJson, storedKeys, writeJson } from "../core/prefs";
import { createOutbox, leftByOthers, type OutboxItem } from "@somnium/shared";
import { refuseSealedInClear, uuidv7 } from "@somnium/engine/sealed-api";
import { savedUserIds } from "../native/accounts";
import { invalidate } from "./live";
import { toast } from "../core/toast";

type Item = OutboxItem;
// Kept per account, so what one account queued can never be replayed into the next one signed in on this device.
// The list made before it was per account can't be told apart, so it isn't kept.
const OLD_KEY = "somniumOutbox";
if (readJson(OLD_KEY, null)) writeJson(OLD_KEY, null);
let key: string | null = null;
export const waiting = ref<Item[]>([]);
// no connection, or the journal key isn't open: nothing is wrong with the change, it just can't go yet
const mustWait = (e: unknown) => (e instanceof ApiError && e.status === 0) || (e as Error)?.name === "LockedError";

// rows deleted on this screen whose deletion may still be waiting here: the screens treat them as gone straight away,
// so a reload from a server that hasn't heard yet doesn't bring them back for a moment
const ended = new Set<string>();
export const endedHere = (id: string | null | undefined) => !!id && ended.has(id);
export const markEnded = (id: string) => { ended.add(id); };

// Every tab of this account shares the list in storage (packages/shared/src/outbox.ts): it is read again before each
// change, so a change queued in another tab is neither overwritten nor left behind when that tab closes.
const box = createOutbox({
  key: () => key,
  storage: { read: (k) => readJson(k, null), write: (k, v) => writeJson(k, v) },
  request: (method, path, body) => (api as any)[method](path, body),
  mustWait,
  // nothing sealed waits in this browser's storage in the clear (the check note is kept sealed in api/checks.ts)
  refuseSealed: refuseSealedInClear,
  newId: uuidv7,
  onRefused: (e, it) => {
    // a change to something deleted meanwhile is expected and quiet; anything else is said, never lost silently.
    // A night made offline for a date that has one by now (one per date): the one there is used, nothing to say
    if (!(e instanceof ApiError && (e.status === 404 || (e.status === 409 && it.method === "post" && it.path === "/nights")))) toast(`A change made offline couldn't be saved: ${(e as Error).message}`, { kind: "err" });
  },
  onChange: (l) => { waiting.value = l; },
  onEmptied: () => { ended.clear(); invalidate(["*"]); },
  locks: () => (navigator as any).locks,
});

addEventListener("storage", (e) => { if (key && e.key === key) { box.reread(); void flush(); } });
/** Whose list this is from now on (null while nobody is signed in): the other account's list stays out of memory. */
export function openOutbox(place: string, userId: string | null) {
  const next = userId ? `${OLD_KEY}:${place}:${userId}` : null;
  if (next === key) return;
  key = next;
  box.reread();
  // someone else signed in here: what an earlier person's ended session left queued waits for them, under their name.
  // Only empty lists go, and none of an account saved in this app (switching back to it works offline).
  if (userId) for (const k of leftByOthers(storedKeys(), `${OLD_KEY}:${place}:`, userId, savedUserIds())) if (!readJson<Item[]>(k, []).length) writeJson(k, null);
  ended.clear();
  void flush();
}
/** An account removed from the app: its queued changes go with it (the person was told first). */
export function forgetOutbox(place: string, userId: string) {
  const k = `${OLD_KEY}:${place}:${userId}`;
  writeJson(k, null);
  if (k === key) box.reread();
}
/** Signing out: what was queued is deleted with the rest of this device's copy, and the person was told first. */
export function clearOutbox() { box.clear(); ended.clear(); }

/** Sends a change now, or keeps it for later when the server can't be reached. Errors from the server itself are
 *  thrown, and so is a body with a sealed column in it: that never waits here (see packages/shared/src/outbox.ts). */
export const send = <T = unknown>(method: Item["method"], path: string, body?: unknown): Promise<T | null> => box.send<T>(method, path, body);
export const flush = () => box.flush();
/** Sends everything still waiting (waiting for a send already under way); true when nothing is left. */
export async function settle() {
  while (box.flushing) await new Promise((ok) => setTimeout(ok, 100));
  await flush();
  return !waiting.value.length;
}
addEventListener("online", flush);
setInterval(flush, 15000);
