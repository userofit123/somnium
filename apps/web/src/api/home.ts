// Home's one write of its own (PLAN.md §6.1): tonight's intention, and beside it the plan for once lucid (LDJ-159).
// Both are sealed columns of the night (packages/engine/src/sealed.ts), so they go through api.put like the Journal's
// night fields: the sealing transport seals them on this device before they leave, and they are never sent in the
// clear. With the device copy (offline use) they save offline; on the direct path they need the connection.
import { uuidv7 } from "@somnium/engine/sealed-api";
import { api } from "./client";
import { invalidate } from "./live";
import { ensureNight, needsServer } from "./journal";

/** Saves one sealed text of a night's date, making the night when there is none (it then holds only a plan). */
async function saveNightText(date: string, field: "intention" | "lucidPlan", text: string) {
  await needsServer(async () => {
    const id = await ensureNight(date, false, uuidv7());
    await api.put(`/nights/${id}`, { [field]: text.trim() || null });
  });
  invalidate(["journal", "train", "home"]);
}

/** Saves the intention for a night's date. */
export const saveIntention = (date: string, text: string) => saveNightText(date, "intention", text);
/** Saves what to do once lucid on a night's date (LDJ-159). */
export const saveLucidPlan = (date: string, text: string) => saveNightText(date, "lucidPlan", text);
