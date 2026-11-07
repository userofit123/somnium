// The optional features' data (LDJ-41): day notes (sealed text, one per date) and goals (plain). Saved through the
// outbox like Train's ticks (goals) or straight to the api (day notes: sealed text); every list is read on the device.
import { useQuery } from "@tanstack/vue-query";
import type { DayNote, Goal, GoalKind } from "@somnium/shared";
import { uuidv7 } from "@somnium/engine/sealed-api";
import { api } from "./client";
import { send } from "./outbox";
import { invalidate } from "./live";

export const useDayNotes = () => useQuery({ queryKey: ["dayNotes"], queryFn: () => api.get<DayNote[]>("/day-notes") });
export const useGoals = () => useQuery({ queryKey: ["goals"], queryFn: () => api.get<Goal[]>("/goals") });

/** The text for a date: a new note, a changed one, or (empty text) the note removed. */
export async function saveDayNote(existing: DayNote | undefined, date: string, text: string) {
  const t = text.trim();
  // straight to the api, not the outbox: the text is sealed on its way (the outbox refuses anything sealed in the clear)
  if (existing && !t) await api.del(`/day-notes/${existing.id}`);
  else if (existing) await api.put(`/day-notes/${existing.id}`, { id: existing.id, date, text: t });
  else if (t) await api.post("/day-notes", { id: uuidv7(), date, text: t });
  invalidate(["dayNotes"]);
}

export async function saveGoal(g: Goal | undefined, kind: GoalKind, target: number, period: Goal["period"]) {
  if (g) await send("put", `/goals/${g.id}`, { kind, target, period });
  else await send("post", "/goals", { id: uuidv7(), kind, target, period });
  invalidate(["goals"]);
}
export async function removeGoal(g: Goal) { await send("del", `/goals/${g.id}`); invalidate(["goals"]); }
