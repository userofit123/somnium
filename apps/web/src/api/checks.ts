// Logging a reality check (PLAN.md §6.4, §9). Only kind, outcome, prompted and time: none of these is sealed, so the
// /check screen can do it without the journal being unlocked. Saved here at once and sent when the server can be
// reached (outbox: no connection, or the key closed while the device's copy waits to sync).
import { checkKindOf, type CheckOutcome } from "@somnium/shared";
import { uuidv7 } from "@somnium/engine/sealed-api";
import { sealText, unsealText } from "@somnium/shared";
import { LockedError } from "@somnium/engine/sealed-api";
import { send, waiting as outboxWaiting } from "./outbox";
import { api, ApiError, httpTransport, isLocalDevice, server } from "./client";
import { noteStoreKey } from "./draftStore";
import { readJson, writeJson } from "../core/prefs";
import { session } from "../core/session";
import { toast } from "../core/toast";
import { keyring } from "../core/keyring";
import { invalidate } from "./live";

/** `given`: a check logged earlier from an Android notification's button (native/reminders.ts flushPending), with the
 *  time it was made at. */
export async function logCheck(checkId: string, outcome: CheckOutcome, prompted: boolean, given?: { id?: string; at: number }): Promise<{ id: string; queued: boolean }> {
  const id = given?.id ?? uuidv7();
  const body = { id, at: new Date(given?.at ?? Date.now()).toISOString(), kind: checkKindOf(checkId), outcome, prompted };
  let queued = false;
  if (!isLocalDevice() && !keyring.isOpen()) {
    // locked: the device's copy can't send a journal table without the key, so this row (nothing sealed in it, the
    // note stays empty) goes straight to the server. The copy picks it up with the next sync after unlocking.
    try { await httpTransport.request("POST", "/reality-checks", body); }
    catch (e) { if (!(e instanceof ApiError && e.status === 0)) throw e; queued = (await send("post", "/reality-checks", body)) === null; }
  } else queued = (await send("post", "/reality-checks", body)) === null;
  invalidate(["checks"]);
  return { id, queued };
}

// ---------- a check's note ----------
// The note is a sealed column (packages/engine/src/sealed.ts), so it never waits in the outbox, whose list sits in
// this browser's storage in the clear. When it can't go at once (no connection, or the check itself still waiting
// in the outbox) it is sealed with the data key, bound to the person and the check, and kept beside the dream drafts
// (api/draftStore.ts) until it can.
type Notes = Record<string, { at: number; sealed: string }>;
const owner = () => session.user?.id ?? "";
const notesKey = () => noteStoreKey(server.value.base || location.origin, owner());
const noteAad = (checkId: string) => `somnium-checknote:${owner()}:${checkId}`;
const readNotes = (): Notes => (owner() ? readJson<Notes>(notesKey(), {}) ?? {} : {});
const writeNotes = (n: Notes) => { if (owner()) writeJson(notesKey(), Object.keys(n).length ? n : null); };
const notePath = (checkId: string) => `/reality-checks/${encodeURIComponent(checkId)}`;
const waitable = (e: unknown) => (e instanceof ApiError && e.status === 0) || (e as Error)?.name === "LockedError";

/** Saves a note on a check; true when it was kept sealed here to be sent later. */
export async function saveCheckNote(checkId: string, note: string | null): Promise<boolean> {
  const notes = readNotes();
  if (!note) {
    // nothing sealed in it: an empty note may wait in the outbox like any change
    if (notes[checkId]) { delete notes[checkId]; writeNotes(notes); }
    return (await send("put", notePath(checkId), { note: null })) === null;
  }
  // the check may still be waiting in the outbox: the note has to follow it, never overtake it
  if (!outboxWaiting.value.length) {
    try { await api.put(notePath(checkId), { note }); if (notes[checkId]) { delete notes[checkId]; writeNotes(notes); } return false; }
    catch (e) { if (!waitable(e)) throw e; }
  }
  const key = keyring.get();
  if (!key) throw new LockedError();
  try {
    const at = Date.now();
    const sealed = await sealText(note, key, noteAad(checkId));
    const now = readNotes();
    now[checkId] = { at, sealed };
    writeNotes(now);
  } finally { key.fill(0); }
  return true;
}

let sendingNotes = false;
/** Sends the notes kept sealed here, once the outbox (with the checks they belong to) has gone out. */
export async function flushCheckNotes() {
  if (sendingNotes || outboxWaiting.value.length || !Object.keys(readNotes()).length) return;
  const key = keyring.get();
  if (!key) return;
  sendingNotes = true;
  try {
    for (const [id, e] of Object.entries(readNotes())) {
      let note: string;
      try { note = await unsealText(e.sealed, key, noteAad(id)); } catch { continue; } // another key's: left for it
      try { await api.put(notePath(id), { note }); }
      catch (err) {
        if (waitable(err)) break;
        // refused (the check was deleted meanwhile is expected and quiet): dropped, and said
        if (!(err instanceof ApiError && err.status === 404)) toast(`A note made offline couldn't be saved: ${(err as Error).message}`, { kind: "err" });
      }
      const now = readNotes();
      if (now[id]?.at === e.at) { delete now[id]; writeNotes(now); }
    }
    invalidate(["checks"]);
  } finally { sendingNotes = false; key.fill(0); }
}
addEventListener("online", () => void flushCheckNotes());
setInterval(() => void flushCheckNotes(), 15000);
