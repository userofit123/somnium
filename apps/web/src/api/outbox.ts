// Changes made without a connection wait here, on the device, and are sent in order when the
// connection is back (PLAN.md §2.2). Each one is replayed exactly once; the screen already shows it.
import { ref } from "vue";
import { api, ApiError } from "./client";
import { readJson, writeJson } from "../core/prefs";
import { invalidate } from "./live";
import { toast } from "../core/toast";

interface Item { method: "post" | "put" | "del"; path: string; body?: unknown; at: number }
const KEY = "somniumOutbox";
export const waiting = ref<Item[]>(readJson(KEY, []));
const save = () => writeJson(KEY, waiting.value);
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
    if (e instanceof ApiError && e.status === 0) { waiting.value.push({ method, path, body, at: Date.now() }); save(); return null; }
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
        if (e instanceof ApiError && e.status === 0) break;
        // refused: drop it rather than block the rest. A change to something deleted meanwhile is expected and quiet;
        // anything else is said, never lost silently
        if (!(e instanceof ApiError && e.status === 404)) toast(`A change made offline couldn't be saved: ${(e as Error).message}`, { kind: "err" });
      }
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
