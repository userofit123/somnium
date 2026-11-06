// The Journal's data on this device (PLAN.md §6.2): the lists the screens read, and the saving behind the dream
// editor. The editor saves as the person types, because the app lock unmounts every screen (core/lock.ts) and a
// draft must survive a lock, a reload and a lost connection.
//
// Where a draft lives until the journal has it:
// - Every change is sealed with the data key at once (never in the clear) into this browser's storage, bound to the
//   person and the dream, and stays there until the journal has it. That copy is what survives a reload or a closed
//   tab in the moment between a keystroke and the save: the journal's own write is asynchronous and a page going
//   away doesn't wait for it. The last change before a lock is sealed in the moment before the key is dropped
//   (keyring.onBeforeClear); a page being hidden or left sends what is waiting at once (flushDrafts).
// - With the device copy (api/replica.ts) or a local account, the save goes into the journal on this device, which
//   works offline; the copy sends it when it can.
// - On the direct server path (no device copy: another tab has it, or this browser can't hold one) the save goes to
//   the server; while it can't, the sealed copy waits and is sent when the server and the key are back.
import { computed, reactive, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { nightOfDate, sealText, unsealText, type Dream, type DreamDraft, type DreamElement, type Element, type Night } from "@somnium/shared";
import { uuidv7 } from "@somnium/engine/sealed-api";
import { api, ApiError, isLocalDevice, server, usingHttp } from "./client";
import { invalidate } from "./live";
import { send } from "./outbox";
import { keyring } from "../core/keyring";
import { readJson, writeJson } from "../core/prefs";
import { draftStoreKey } from "./draftStore";
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
// dream ids with a sealed copy in storage (which includes the one being typed, until it is saved)
const storedIds = ref<string[]>([]);
/** Drafts kept sealed on this device that the journal hasn't got: waiting for the server, or left by a closed page. */
export const unsent = reactive({ ids: computed(() => storedIds.value.filter((id) => !drafts.has(id) || saveState[id] === "waiting" || saveState[id] === "error")) });

type Stored = Record<string, { at: number; sealed: string }>;
const owner = () => session.user?.id ?? "";
const storeKey = () => draftStoreKey(server.value.base || location.origin, owner());
const aad = (dreamId: string) => `somnium-draft:${owner()}:${dreamId}`;
const readStore = (): Stored => (owner() ? readJson<Stored>(storeKey(), {}) : {});
function writeStore(s: Stored) {
  if (!owner()) return;
  if (Object.keys(s).length) writeJson(storeKey(), s); else try { localStorage.removeItem(storeKey()); } catch { /* storage blocked: nothing kept anyway */ }
  storedIds.value = Object.keys(s);
}

const drafts = new Map<string, DreamDraft & { nap: boolean }>();
// the newest change of each dream the journal has: a seal finishing after that must not bring it back as unsent
const sentUpTo = new Map<string, number>();

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
  if (!drafts.has(d.dreamId) || (s[d.dreamId]?.at ?? 0) > at || (sentUpTo.get(d.dreamId) ?? 0) >= at) return;
  s[d.dreamId] = { at, sealed };
  writeStore(s);
}
// at once, with every change: sealing a dream's text takes well under a millisecond, and any wait here is a window
// in which a reload loses the last words (a slower seal finishing late never replaces a newer one, see seal())
function sealNow(d: DreamDraft) {
  const key = keyring.get();
  if (key) void seal(d, key).finally(() => key.fill(0));
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
  sealNow(d);
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
function pushSoon(dreamId: string, ms = 400) {
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
  // a draft is only ever sent under the session of the person who wrote it (another may sign in on this tab meanwhile)
  const who = owner();
  const mine = () => { if (!who || owner() !== who) throw new Error("signed out"); };
  try {
    mine(); const nightId = await ensureNight(snap.date, snap.nap, snap.nightId);
    mine(); if (Object.keys(snap.night).length) await api.put(`/nights/${nightId}`, snap.night);
    for (const e of snap.newElements) {
      mine(); const there = await api.get(`/elements/${e.id}`).then(() => true, (x) => { if (status(x) === 404) return false; throw x; });
      mine(); if (!there) await api.post("/elements", { id: e.id, name: e.name, kind: e.kind });
    }
    const body = { ...snap.dream, nightId };
    mine();
    try { await api.put(`/dreams/${dreamId}`, body); }
    catch (e) { if (status(e) !== 404) throw e; mine(); await api.post("/dreams", { ...body, id: dreamId }); }
    for (const id of snap.link) { mine(); await api.post(`/dreams/${dreamId}/elements`, { elementId: id, source: "manual" }); }
    for (const id of snap.unlink) { mine(); await api.del(`/dreams/${dreamId}/elements/${id}`).catch((e) => { if (status(e) !== 404) throw e; }); }
    if (owner() !== who) return;
    // sent: take off what went, keep anything newer
    d.nightId = d.date === snap.date && d.nap === snap.nap ? nightId : d.nightId;
    for (const [k, v] of Object.entries(snap.night)) if (JSON.stringify(d.night[k]) === JSON.stringify(v)) delete d.night[k];
    d.newElements = d.newElements.filter((e) => !snap.newElements.some((x) => x.id === e.id));
    d.link = d.link.filter((x) => !snap.link.includes(x));
    d.unlink = d.unlink.filter((x) => !snap.unlink.includes(x));
    sentUpTo.set(dreamId, snap.savedAt);
    if (d.savedAt === snap.savedAt) { dropStored(dreamId, snap.savedAt); saveState[dreamId] = "saved"; }
    delete saveError[dreamId];
    invalidate(["journal"]);
  } catch (e) {
    if (owner() !== who) return; // that person's draft was sealed under their name as the key left
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
  storedIds.value = Object.keys(readStore());
  for (const id of storedIds.value) {
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

/** The page is going away or out of sight: what is waiting is sealed (it already is, see sealNow) and sent now. */
export function flushDrafts() {
  for (const d of drafts.values()) {
    if (!saveState[d.dreamId] || saveState[d.dreamId] === "saved") continue;
    sealNow(d);
    if (pushTimers.has(d.dreamId)) saveNow(d.dreamId);
  }
}
addEventListener("pagehide", flushDrafts);
addEventListener("beforeunload", flushDrafts);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushDrafts(); });

// The lock is about to drop the key: every draft held in memory is sealed with a copy taken now.
keyring.onBeforeClear(() => {
  for (const d of drafts.values()) {
    // untouched (nothing typed yet) or already with the server: nothing to keep
    if (!saveState[d.dreamId] || saveState[d.dreamId] === "saved") continue;
    const key = keyring.get();
    if (key) void seal(d, key).finally(() => key.fill(0));
  }
});
keyring.onChange((open) => { if (open) void sendStored(); });
// Another person on this tab (or nobody): this tab's drafts belonged to the one before, and must never be sent under
// the new session. What wasn't sent was sealed under that person's name as the key left, for their next sign-in.
watch(() => session.user?.id, (now, before) => {
  if (now === before) return;
  for (const t of pushTimers.values()) clearTimeout(t);
  pushTimers.clear(); drafts.clear(); sentUpTo.clear(); again.clear();
  for (const k of Object.keys(saveState)) delete saveState[k];
  for (const k of Object.keys(saveError)) delete saveError[k];
  storedIds.value = Object.keys(readStore());
}, { flush: "sync" });
addEventListener("online", () => void sendStored());
setInterval(() => void sendStored(), 20_000);
