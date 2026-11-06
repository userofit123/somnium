// The Journal's data on this device (PLAN.md §6.2): the lists the screens read, and the saving behind the dream
// editor. The editor saves as the person types, because the app lock unmounts every screen (core/lock.ts) and a
// draft must survive a lock, a reload and a lost connection.
//
// Where a draft lives until the journal has it:
// - With the device copy (api/replica.ts) or a local account, every save goes straight into the journal on this
//   device, which works offline; the copy sends it when it can. Nothing else is kept.
// - On the direct server path (no device copy: another tab has it, or this browser can't hold one) a save that
//   hasn't reached the server is kept in this browser's storage sealed with the data key (never in the clear),
//   bound to the person and the dream, and sent when the server and the key are back. The last change before a
//   lock is sealed in the moment before the key is dropped (keyring.onBeforeClear).
import { reactive } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { nightOfDate, sealText, unsealText, type Dream, type DreamDraft, type DreamElement, type Element, type Night } from "@somnium/shared";
import { uuidv7 } from "@somnium/engine/sealed-api";
import { api, ApiError, isLocalDevice, server, usingHttp } from "./client";
import { invalidate } from "./live";
import { send } from "./outbox";
import { keyring } from "../core/keyring";
import { readJson, writeJson } from "../core/prefs";
import { session } from "../core/session";

export type NightRow = Night & { dreamCount: number; lucidCount: number };
export type DreamRow = Dream & { date: string };
export type DreamFull = Dream & { elements: DreamElement[] };
/** The engine sends at most this many dreams in one list. */
export const DREAM_LIMIT = 2000;
export { uuidv7 };

/** Whether the journal being read is the one on this device (the copy or a local account), not the server's. */
export const onDevice = () => !usingHttp() || isLocalDevice();

// every list is filed under "journal", so a change to nights, dreams or elements refreshes it live (shared live.ts)
export function useJournal() {
  return {
    nights: useQuery({ queryKey: ["journal", "nights"], queryFn: () => api.get<NightRow[]>("/nights") }),
    dreams: useQuery({ queryKey: ["journal", "dreams"], queryFn: () => api.get<DreamRow[]>("/dreams", { limit: DREAM_LIMIT }) }),
    elements: useQuery({ queryKey: ["journal", "elements"], queryFn: () => api.get<Element[]>("/elements") }),
    links: useQuery({ queryKey: ["journal", "links"], queryFn: () => api.get<DreamElement[]>("/dream-elements") }),
  };
}

const isWaitable = (e: unknown) => (e instanceof ApiError && e.status === 0) || (e as Error)?.name === "LockedError";
const status = (e: unknown) => (e instanceof ApiError ? e.status : -1);

/**
 * The night of a date, made when there is none. One night per date is the rule (a nap is its own row), so a 409
 * means another device or tab made it first: that one is used, and the person never sees an error.
 */
export async function ensureNight(date: string, nap: boolean, wantedId: string): Promise<string> {
  const known = await api.get<NightRow[]>("/nights", { from: date, to: date });
  const mine = known.find((n) => n.id === wantedId && n.date === date && n.nap === nap);
  if (mine) return mine.id;
  if (!nap) { const n = nightOfDate(known, date); if (n) return n.id; }
  try {
    return (await api.post<Night>("/nights", { id: wantedId, date, nap })).id;
  } catch (e) {
    if (status(e) !== 409) throw e;
    const n = nightOfDate(await api.get<NightRow[]>("/nights", { from: date, to: date }), date);
    if (!n) throw e;
    return n.id;
  }
}

/** "No recall" for a night: logs the night with no dreams. Already logged is fine. Offline on the direct path it waits in the outbox (a date carries nothing sealed). */
export async function markNoRecall(date: string) {
  try { await ensureNight(date, false, uuidv7()); }
  catch (e) { if (!isWaitable(e) || onDevice()) throw e; await send("post", "/nights", { id: uuidv7(), date }); }
  invalidate(["journal", "home"]);
}

// ---------- drafts ----------

/** How each dream being written stands: shown quietly in the editor, never as a toast. */
export type SaveState = "saving" | "saved" | "waiting" | "error";
export const saveState = reactive<Record<string, SaveState>>({});
export const saveError = reactive<Record<string, string>>({});
/** Drafts kept sealed on this device, waiting for the server (the direct path only), by dream id. */
export const unsent = reactive<{ ids: string[] }>({ ids: [] });

type Stored = Record<string, { at: number; sealed: string }>;
const owner = () => session.user?.id ?? "";
const storeKey = () => `somniumDrafts:${server.value.base || location.origin}:${owner()}`;
const aad = (dreamId: string) => `somnium-draft:${owner()}:${dreamId}`;
const readStore = (): Stored => (owner() ? readJson<Stored>(storeKey(), {}) : {});
function writeStore(s: Stored) {
  if (!owner()) return;
  if (Object.keys(s).length) writeJson(storeKey(), s); else try { localStorage.removeItem(storeKey()); } catch { /* storage blocked: nothing kept anyway */ }
  unsent.ids = Object.keys(s);
}

const drafts = new Map<string, DreamDraft & { nap: boolean }>();

/** A draft sealed in this browser's storage, opened (null without the key or when there is none). */
export async function openStored(dreamId: string): Promise<(DreamDraft & { nap: boolean }) | null> {
  const e = readStore()[dreamId];
  const key = e ? keyring.get() : null;
  if (!e || !key) return null;
  try { return JSON.parse(await unsealText(e.sealed, key, aad(dreamId))); } catch { return null; } finally { key.fill(0); }
}
/** The draft this tab holds for a dream, if any (it outlives the editor, for a lock in mid-sentence). */
export const liveDraft = (dreamId: string) => drafts.get(dreamId) ?? null;

async function seal(d: DreamDraft, key: Uint8Array) {
  const at = d.savedAt;
  const sealed = await sealText(JSON.stringify(d), key, aad(d.dreamId));
  const s = readStore();
  // only ever replaced by a newer change, and not brought back once it was sent
  if (!drafts.has(d.dreamId) || (s[d.dreamId]?.at ?? 0) > at) return;
  s[d.dreamId] = { at, sealed };
  writeStore(s);
}
const sealTimers = new Map<string, ReturnType<typeof setTimeout>>();
function sealSoon(d: DreamDraft) {
  if (onDevice()) return;
  clearTimeout(sealTimers.get(d.dreamId));
  sealTimers.set(d.dreamId, setTimeout(() => {
    const key = keyring.get();
    if (key) void seal(d, key).finally(() => key.fill(0));
  }, 150));
}
function dropStored(dreamId: string, at: number) {
  const s = readStore();
  if (s[dreamId] && s[dreamId]!.at <= at) { delete s[dreamId]; writeStore(s); }
}

/** Starts (or takes up again) the draft of a dream. Nothing is saved until the first change. */
export function beginDraft(d: DreamDraft & { nap: boolean }) { drafts.set(d.dreamId, d); }

function touch(d: DreamDraft) {
  d.savedAt = Math.max(Date.now(), d.savedAt + 1);
  saveState[d.dreamId] = "saving";
  sealSoon(d);
  pushSoon(d.dreamId);
}
/** The dream's fields as the person left them: every field, each time. */
export function changeDream(dreamId: string, fields: Record<string, unknown>) {
  const d = drafts.get(dreamId); if (!d) return;
  d.dream = { ...fields }; touch(d);
}
/** Fields of the dream's night the person changed in the night details sheet. */
export function changeNight(dreamId: string, fields: Record<string, unknown>) {
  const d = drafts.get(dreamId); if (!d) return;
  d.night = { ...d.night, ...fields }; touch(d);
}
/** Moves the dream to the night of another date (or to a nap): the night's own id is found or made on saving. */
export function moveDream(dreamId: string, date: string, nap: boolean, nightId: string) {
  const d = drafts.get(dreamId); if (!d) return;
  d.date = date; d.nap = nap; d.nightId = nightId; d.night = {}; touch(d);
}
export function linkElement(dreamId: string, elementId: string, made?: { name: string; kind: string }) {
  const d = drafts.get(dreamId); if (!d) return;
  if (made) d.newElements.push({ id: elementId, ...made });
  d.unlink = d.unlink.filter((x) => x !== elementId);
  if (!d.link.includes(elementId)) d.link.push(elementId);
  touch(d);
}
export function unlinkElement(dreamId: string, elementId: string) {
  const d = drafts.get(dreamId); if (!d) return;
  d.link = d.link.filter((x) => x !== elementId);
  d.newElements = d.newElements.filter((x) => x.id !== elementId);
  if (!d.unlink.includes(elementId)) d.unlink.push(elementId);
  touch(d);
}

const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
function pushSoon(dreamId: string, ms = 700) {
  clearTimeout(pushTimers.get(dreamId));
  pushTimers.set(dreamId, setTimeout(() => void push(dreamId), ms));
}
/** Saves now what is waiting for a dream (the editor closing, or being unmounted by the lock). */
export function saveNow(dreamId: string) { if (pushTimers.has(dreamId)) { clearTimeout(pushTimers.get(dreamId)); pushTimers.delete(dreamId); void push(dreamId); } }

const pushing = new Set<string>(), again = new Set<string>();
async function push(dreamId: string, fromStore?: DreamDraft & { nap: boolean }) {
  pushTimers.delete(dreamId);
  if (pushing.has(dreamId)) { again.add(dreamId); return; }
  const d = drafts.get(dreamId) ?? fromStore;
  if (!d) return;
  pushing.add(dreamId);
  // what is sent this time: changes made while it is on its way stay for the next one
  const snap = structuredClone({ ...d });
  try {
    const nightId = await ensureNight(snap.date, snap.nap, snap.nightId);
    if (Object.keys(snap.night).length) await api.put(`/nights/${nightId}`, snap.night);
    for (const e of snap.newElements) {
      const there = await api.get(`/elements/${e.id}`).then(() => true, (x) => { if (status(x) === 404) return false; throw x; });
      if (!there) await api.post("/elements", { id: e.id, name: e.name, kind: e.kind });
    }
    const body = { ...snap.dream, nightId };
    try { await api.put(`/dreams/${dreamId}`, body); }
    catch (e) { if (status(e) !== 404) throw e; await api.post("/dreams", { ...body, id: dreamId }); }
    for (const id of snap.link) await api.post(`/dreams/${dreamId}/elements`, { elementId: id, source: "manual" });
    for (const id of snap.unlink) await api.del(`/dreams/${dreamId}/elements/${id}`).catch((e) => { if (status(e) !== 404) throw e; });
    // sent: take off what went, keep anything newer
    d.nightId = d.date === snap.date && d.nap === snap.nap ? nightId : d.nightId;
    for (const [k, v] of Object.entries(snap.night)) if (JSON.stringify(d.night[k]) === JSON.stringify(v)) delete d.night[k];
    d.newElements = d.newElements.filter((e) => !snap.newElements.some((x) => x.id === e.id));
    d.link = d.link.filter((x) => !snap.link.includes(x));
    d.unlink = d.unlink.filter((x) => !snap.unlink.includes(x));
    if (d.savedAt === snap.savedAt) { dropStored(dreamId, snap.savedAt); saveState[dreamId] = "saved"; }
    delete saveError[dreamId];
    invalidate(["journal"]);
  } catch (e) {
    if (isWaitable(e)) saveState[dreamId] = onDevice() ? "saving" : "waiting";
    else { saveState[dreamId] = "error"; saveError[dreamId] = e instanceof Error ? e.message : "Couldn't save"; }
  } finally {
    pushing.delete(dreamId);
    if (again.delete(dreamId)) pushSoon(dreamId, 0);
  }
}

/** Sends every draft kept sealed here (after an unlock, coming back online, or now and then). */
export async function sendStored() {
  if (!keyring.isOpen()) return;
  unsent.ids = Object.keys(readStore());
  for (const id of unsent.ids) {
    if (drafts.has(id)) { void push(id); continue; }
    const d = await openStored(id);
    if (d) await push(id, d);
  }
}

/** Removes a dream (and any draft of it). */
export async function deleteDream(dreamId: string) {
  drafts.delete(dreamId); clearTimeout(pushTimers.get(dreamId)); pushTimers.delete(dreamId);
  dropStored(dreamId, Number.MAX_SAFE_INTEGER);
  await api.del(`/dreams/${dreamId}`).catch((e) => { if (status(e) !== 404) throw e; });
  invalidate(["journal", "home"]);
}

/** Finished with a draft in this tab (the editor closed and everything was sent). */
export function endDraft(dreamId: string) {
  // one still on its way, or waiting for the server, stays: it is sent from here (and is sealed in storage too)
  if ((!saveState[dreamId] || saveState[dreamId] === "saved") && !pushTimers.has(dreamId) && !pushing.has(dreamId)) drafts.delete(dreamId);
}

// The lock is about to drop the key: every draft held in memory is sealed with a copy taken now.
keyring.onBeforeClear(() => {
  if (onDevice()) return;
  for (const d of drafts.values()) {
    // untouched (nothing typed yet) or already with the server: nothing to keep
    if (!saveState[d.dreamId] || saveState[d.dreamId] === "saved") continue;
    const key = keyring.get();
    if (key) void seal(d, key).finally(() => key.fill(0));
  }
});
keyring.onChange((open) => { if (open) void sendStored(); });
addEventListener("online", () => void sendStored());
setInterval(() => void sendStored(), 20_000);
