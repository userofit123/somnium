// Home's one write of its own (PLAN.md §6.1): tonight's intention. It is a sealed column of the night
// (packages/engine/src/sealed.ts), so it goes through api.put like the Journal's night fields: the sealing transport
// seals it on this device before it leaves, and it is never sent in the clear.
import { uuidv7 } from "@somnium/engine/sealed-api";
import { api } from "./client";
import { invalidate } from "./live";
import { ensureNight } from "./journal";

/** Saves the intention for a night's date, making the night when there is none (it then holds only a plan). */
export async function saveIntention(date: string, text: string) {
  const id = await ensureNight(date, false, uuidv7());
  await api.put(`/nights/${id}`, { intention: text.trim() || null });
  invalidate(["journal", "train", "home"]);
}
