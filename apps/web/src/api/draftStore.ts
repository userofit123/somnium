// Where drafts sealed on this device are kept (api/journal.ts): one entry per server and person, so one person's
// drafts are never opened, sent or counted under another's session. Kept apart so signing out (core/session.ts)
// can see and remove them without loading the journal.
import { readJson } from "../core/prefs";

export const draftStoreKey = (place: string, userId: string) => `somniumDrafts:${place}:${userId}`;

/** How many dreams this person has sealed here that the journal hasn't got. */
export const storedDraftCount = (place: string, userId: string) => Object.keys(readJson<Record<string, unknown>>(draftStoreKey(place, userId), {}) ?? {}).length;

/** Removes them (signing out, after the person was told they'd go). */
export function forgetStoredDrafts(place: string, userId: string) {
  try { localStorage.removeItem(draftStoreKey(place, userId)); } catch { /* storage blocked: nothing was kept */ }
}
