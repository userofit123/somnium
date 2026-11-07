// Where drafts sealed on this device are kept (api/journal.ts): one entry per server and person, so one person's
// drafts are never opened, sent or counted under another's session. Kept apart so signing out (core/session.ts)
// can see and remove them without loading the journal.
// Reality check notes waiting for the server are kept the same way, sealed, next to them (api/checks.ts): a note is
// a sealed column and may not wait in the outbox's list in the clear.
import { readJson } from "../core/prefs";

export const draftStoreKey = (place: string, userId: string) => `somniumDrafts:${place}:${userId}`;
export const noteStoreKey = (place: string, userId: string) => `somniumCheckNotes:${place}:${userId}`;
// Day notes written offline wait here the same way, sealed, one per date (api/extras.ts).
export const dayNoteStoreKey = (place: string, userId: string) => `somniumDayNotes:${place}:${userId}`;

const count = (k: string) => Object.keys(readJson<Record<string, unknown>>(k, {}) ?? {}).length;
/** How many dreams, check notes and day notes this person has sealed here that the journal hasn't got. */
export const storedDraftCount = (place: string, userId: string) => count(draftStoreKey(place, userId)) + count(noteStoreKey(place, userId)) + count(dayNoteStoreKey(place, userId));

/** Removes them (signing out, after the person was told they'd go). */
export function forgetStoredDrafts(place: string, userId: string) {
  try { localStorage.removeItem(draftStoreKey(place, userId)); localStorage.removeItem(noteStoreKey(place, userId)); localStorage.removeItem(dayNoteStoreKey(place, userId)); } catch { /* storage blocked: nothing was kept */ }
}
