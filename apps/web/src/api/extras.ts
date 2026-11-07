// The optional features' data (LDJ-41): day notes (sealed text, one per date) and goals (plain). Saved through the
// outbox like Train's ticks (goals) or straight to the api (day notes: sealed text, kept sealed here while offline);
// every list is read on the device.
import { ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { sealText, unsealText, type DayNote, type Goal, type GoalKind } from "@somnium/shared";
import { LockedError, uuidv7 } from "@somnium/engine/sealed-api";
import { api, ApiError, server } from "./client";
import { dayNoteStoreKey } from "./draftStore";
import { readJson, writeJson } from "../core/prefs";
import { session } from "../core/session";
import { keyring } from "../core/keyring";
import { toast } from "../core/toast";
import { send } from "./outbox";
import { invalidate } from "./live";

export const useDayNotes = () => useQuery({ queryKey: ["dayNotes"], queryFn: () => api.get<DayNote[]>("/day-notes") });
export const useGoals = () => useQuery({ queryKey: ["goals"], queryFn: () => api.get<Goal[]>("/goals") });

// ---------- day notes written offline ----------
// The text is a sealed column, so it never waits in the outbox (its list sits in this browser's storage in the clear).
// When it can't go at once it is sealed with the data key, bound to the person and the date, and kept beside the dream
// drafts (api/draftStore.ts), one per date, until it can: flushDayNotes sends it to the note that is there for that date
// then (or makes one), so it is never sent under an id it wasn't written for.
type Waiting = Record<string, { at: number; sealed: string }>;
const owner = () => session.user?.id ?? "";
const storeKey = () => dayNoteStoreKey(server.value.base || location.origin, owner());
const aad = (date: string) => `somnium-daynote:${owner()}:${date}`;
const readWaiting = (): Waiting => (owner() ? readJson<Waiting>(storeKey(), {}) ?? {} : {});
const writeWaiting = (w: Waiting) => { if (owner()) writeJson(storeKey(), Object.keys(w).length ? w : null); };
const waitable = (e: unknown) => (e instanceof ApiError && e.status === 0) || (e as Error)?.name === "LockedError";
/** Dates with a note kept here to send later (DayNoteCard says so). */
export const waitingDayNotes = ref<string[]>(Object.keys(readWaiting()));
const refresh = () => { waitingDayNotes.value = Object.keys(readWaiting()); };

/** The text kept here for a date, opened with the key; null when there is none (or it can't be opened now). */
export async function waitingDayNote(date: string): Promise<string | null> {
  const e = readWaiting()[date];
  const key = e ? keyring.get() : null;
  if (!e || !key) return null;
  try { return await unsealText(e.sealed, key, aad(date)); } catch { return null; } finally { key.fill(0); }
}

async function sendNote(date: string, text: string) {
  const t = text.trim();
  // the note there now, from the server: the one on screen may be out of date, and a second note for a date is refused
  const there = (await api.get<DayNote[]>("/day-notes", { from: date, to: date })).find((n) => n.date === date);
  // straight to the api, not the outbox: the text is sealed on its way, bound to the note's own id
  if (there && !t) await api.del(`/day-notes/${there.id}`);
  else if (there) { if (there.text !== t) await api.put(`/day-notes/${there.id}`, { id: there.id, date, text: t }); }
  else if (t) await api.post("/day-notes", { id: uuidv7(), date, text: t });
}

/** The text for a date: a new note, a changed one, or (empty text) the note removed. True when it was kept sealed
 *  here to be sent later (no connection). */
export async function saveDayNote(date: string, text: string): Promise<boolean> {
  try {
    await sendNote(date, text);
    const w = readWaiting(); if (w[date]) { delete w[date]; writeWaiting(w); refresh(); }
    invalidate(["dayNotes"]);
    return false;
  } catch (e) { if (!waitable(e)) throw e; }
  const key = keyring.get();
  if (!key) throw new LockedError();
  try {
    const sealed = await sealText(text.trim(), key, aad(date));
    const w = readWaiting(); w[date] = { at: Date.now(), sealed }; writeWaiting(w); refresh();
  } finally { key.fill(0); }
  return true;
}

let sending = false;
/** Sends the day notes kept here, once there is a connection and the key is open. */
export async function flushDayNotes() {
  if (sending || !Object.keys(readWaiting()).length) return;
  const key = keyring.get();
  if (!key) return;
  sending = true;
  try {
    for (const [date, e] of Object.entries(readWaiting())) {
      let text: string;
      try { text = await unsealText(e.sealed, key, aad(date)); } catch { continue; } // another key's: left for it
      try { await sendNote(date, text); }
      catch (err) {
        if (waitable(err)) break;
        toast(`A day note made offline couldn't be saved: ${(err as Error).message}`, { kind: "err" });
      }
      const now = readWaiting();
      if (now[date]?.at === e.at) { delete now[date]; writeWaiting(now); }
    }
    refresh();
    invalidate(["dayNotes"]);
  } finally { sending = false; key.fill(0); }
}
addEventListener("online", () => void flushDayNotes());
setInterval(() => void flushDayNotes(), 15000);

export async function saveGoal(g: Goal | undefined, kind: GoalKind, target: number, period: Goal["period"]) {
  if (g) await send("put", `/goals/${g.id}`, { kind, target, period });
  else await send("post", "/goals", { id: uuidv7(), kind, target, period });
  invalidate(["goals"]);
}
export async function removeGoal(g: Goal) { await send("del", `/goals/${g.id}`); invalidate(["goals"]); }
