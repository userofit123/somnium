// Where drafts sealed on this device are kept (api/journal.ts): one entry per server and person, so one person's
// drafts are never opened, sent or counted under another's session. Kept apart so signing out (core/session.ts)
// can see and remove them without loading the journal.
// Reality check notes waiting for the server are kept the same way, sealed, next to them (api/checks.ts): a note is
// a sealed column and may not wait in the outbox's list in the clear.
import { readJson, storedKeys, writeJson } from "../core/prefs";

export const draftStoreKey = (place: string, userId: string) => `somniumDrafts:${place}:${userId}`;
export const noteStoreKey = (place: string, userId: string) => `somniumCheckNotes:${place}:${userId}`;
// Day notes written offline wait here the same way, sealed, one per date (api/extras.ts).
export const dayNoteStoreKey = (place: string, userId: string) => `somniumDayNotes:${place}:${userId}`;
// The safety check's answers, sealed (components/setup/safety.ts): personal health information that only this device
// keeps, so it goes with the drafts when the person signs out or the account is removed. Not counted as unsent.
export const safetyStoreKey = (place: string, userId: string) => `somniumSafety:${place}:${userId}`;

// What the editor remembers having shown on this device (core/seenOnDevice.ts): ids and kinds only, kept per app
// account and person as `<name>:<account>:<user>`, so signing out or removing the account can find them by the user.
export const SEEN_ON_DEVICE = ["somniumHardNoteSeen", "somniumSignsShown"] as const;

const count = (k: string) => Object.keys(readJson<Record<string, unknown>>(k, {}) ?? {}).length;
/** How many dreams, check notes and day notes this person has sealed here that the journal hasn't got. */
export const storedDraftCount = (place: string, userId: string) => count(draftStoreKey(place, userId)) + count(noteStoreKey(place, userId)) + count(dayNoteStoreKey(place, userId));

/** Removes them, and the safety check's answers (signing out, after the person was told they'd go; removing the account). */
export function forgetStoredDrafts(place: string, userId: string) {
  try {
    for (const k of [draftStoreKey, noteStoreKey, dayNoteStoreKey, safetyStoreKey]) localStorage.removeItem(k(place, userId));
    localStorage.removeItem(`somniumSafety:${userId}`); // the unsealed record of builds before the answers were sealed
    for (const k of storedKeys()) if (SEEN_ON_DEVICE.some((n) => k.startsWith(`${n}:`)) && k.endsWith(`:${userId}`)) writeJson(k, null);
  } catch { /* storage blocked: nothing was kept */ }
}
