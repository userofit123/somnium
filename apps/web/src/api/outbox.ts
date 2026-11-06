// Changes made without a connection wait here, on the device, and are sent in order when the
// connection is back (PLAN.md §2.2). Each one is replayed exactly once; the screen already shows it.
import { ref } from "vue";
import { api, ApiError } from "./client";
import { readJson, storedKeys, writeJson } from "../core/prefs";
import { leftByOthers } from "@somnium/shared";
import { savedUserIds } from "../native/accounts";
import { invalidate } from "./live";
import { toast } from "../core/toast";

interface Item { method: "post" | "put" | "del"; path: string; body?: unknown; at: number }
// Kept per account, so what one account queued can never be replayed into the next one signed in on this device.
// The list made before it was per account can't be told apart, so it isn't kept.
const OLD_KEY = "somniumOutbox";
if (readJson(OLD_KEY, null)) writeJson(OLD_KEY, null);
let key: string | null = null;
export const waiting = ref<Item[]>([]);
const save = () => { if (key) writeJson(key, waiting.value); };
/** Whose list this is from now on (null while nobody is signed in): the other account's list stays out of memory. */
export function openOutbox(place: string, userId: string | null) {
  const next = userId ? `${OLD_KEY}:${place}:${userId}` : null;
  if (next === key) return;
  key = next;
  waiting.value = key ? readJson<Item[]>(key, []) : [];
  // someone else signed in here: what an earlier person's ended session left queued waits for them, under their name.
  // Only empty lists go, and none of an account saved in this app (switching back to it works offline).
  if (userId) for (const k of leftByOthers(storedKeys(), `${OLD_KEY}:${place}:`, userId, savedUserIds())) if (!readJson<Item[]>(k, []).length) writeJson(k, null);
  ended.clear();
  void flush();
}
/** An account removed from the app: its queued changes go with it (the person was told first). */
export function forgetOutbox(place: string, userId: string) {
  const k = `${OLD_KEY}:${place}:${userId}`;
  if (k === key) waiting.value = [];
  writeJson(k, null);
}
/** Signing out: what was queued is deleted with the rest of this device's copy, and the person was told first. */
export function clearOutbox() { waiting.value = []; save(); ended.clear(); }
// no connection, or the journal key isn't open: nothing is wrong with the change, it just can't go yet
const mustWait = (e: unknown) => (e instanceof ApiError && e.status === 0) || (e as Error)?.name === "LockedError";
let flushing = false;

// rows deleted on this screen whose deletion may still be waiting here: the screens treat them as gone straight away,
// so a reload from a server that hasn't heard yet doesn't bring them back for a moment
const ended = new Set<string>();
export const endedHere = (id: string | null | undefined) => !!id && ended.has(id);
export const markEnded = (id: string) => { ended.add(id); };

/** Sends a change now, or keeps it for later when the server can't be reached. Errors from the server itself are thrown. */
export async function send<T = unknown>(method: Item["method"], path: string, body?: unknown): Promise<T | null> {
  if (waiting.value.length) { waiting.value.push({ method, path, body, at: Date.now() }); save(); flush(); return null; }
  try {
    return (await (api as any)[method](path, body)) as T;
  } catch (e) {
    if (mustWait(e)) { waiting.value.push({ method, path, body, at: Date.now() }); save(); return null; }
    throw e;
  }
}
export async function flush() {
  if (flushing || !waiting.value.length) return;
  flushing = true;
  try {
    while (waiting.value.length) {
      const it = waiting.value[0]!;
      try { await (api as any)[it.method](it.path, it.body); }
      catch (e) {
        if (mustWait(e)) break;
        // refused: drop it rather than block the rest. A change to something deleted meanwhile is expected and quiet;
        // anything else is said, never lost silently
        // a night made offline for a date that has one by now (one per date): the one there is used, nothing to say
        if (!(e instanceof ApiError && (e.status === 404 || (e.status === 409 && it.method === "post" && it.path === "/nights")))) toast(`A change made offline couldn't be saved: ${(e as Error).message}`, { kind: "err" });
      }
      // the list may have been cleared or changed hands while this was on its way
      if (waiting.value[0] !== it) break;
      waiting.value.shift(); save();
    }
    if (!waiting.value.length) { ended.clear(); invalidate(["*"]); }
  } finally { flushing = false; }
}
/** Sends everything still waiting (waiting for a send already under way); true when nothing is left. */
export async function settle() {
  while (flushing) await new Promise((ok) => setTimeout(ok, 100));
  await flush();
  return !waiting.value.length;
}
addEventListener("online", flush);
setInterval(flush, 15000);
