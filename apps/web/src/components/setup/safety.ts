// The safety check's answers (LDJ-116). Which item was a yes is personal health information, so it never leaves this
// device: not to the server, not sealed, not in exports or backups. Only the outcome syncs, as a plain training
// preference (settings.safety.sleepFirst: no WBTB, CAT or nap suggestions), so every device follows it without
// knowing why. Kept per account, so two accounts in one browser never see each other's answers.
import { computed, ref, watch } from "vue";
import type { SafetyPage } from "@somnium/shared";
import { readJson, writeJson } from "../../core/prefs";
import { session } from "../../core/session";

/** The yes/no items, from Learn's "Who should be careful" (RESEARCH.md Part B §6.2) and "Sleep first" (D1). */
export const SAFETY_ITEMS = [
  { id: "sleep", label: "A sleep problem", hint: "Such as insomnia, sleep apnoea or narcolepsy", page: "who-should-be-careful" },
  { id: "mind", label: "Times when waking life feels unreal", hint: "Or psychosis, bipolar disorder, or trouble telling dreams from waking", page: "who-should-be-careful" },
  { id: "low", label: "A hard time right now", hint: "Depression, grief or trauma, without someone helping you with it", page: "who-should-be-careful" },
  { id: "alert", label: "Little room for lost sleep", hint: "Already short on sleep, or shift work or early driving that needs you fully alert", page: "sleep-first" },
] as const satisfies readonly { id: string; label: string; hint: string; page: SafetyPage }[];
export type SafetyItem = (typeof SAFETY_ITEMS)[number]["id"];

interface Kept { items: SafetyItem[]; /** the page still to show once in "For you"; "" once read or put away */ page: SafetyPage | "" }
const KEY = (id: string) => `somniumSafety:${id}`;
const EMPTY: Kept = { items: [], page: "" };
const known = new Set<string>(SAFETY_ITEMS.map((x) => x.id));

const kept = ref<Kept>(EMPTY);
watch(() => session.user?.id, (id) => {
  const v = id ? readJson<Partial<Kept>>(KEY(id), EMPTY) : EMPTY;
  kept.value = { items: (Array.isArray(v.items) ? v.items : []).filter((x): x is SafetyItem => known.has(x)), page: v.page === "who-should-be-careful" || v.page === "sleep-first" ? v.page : "" };
}, { immediate: true });
function save(v: Kept) {
  kept.value = v;
  const id = session.user?.id;
  if (id) writeJson(KEY(id), v.items.length || v.page ? v : null);
}

export const safetyAnswers = computed(() => kept.value.items);
export const safetyPage = computed(() => kept.value.page || undefined);

/** The page a set of answers points to: the wider one when any answer is about health, else Sleep first. */
export function pageFor(items: readonly SafetyItem[]): SafetyPage | "" {
  const pages = SAFETY_ITEMS.filter((x) => items.includes(x.id)).map((x) => x.page);
  return pages.includes("who-should-be-careful") ? "who-should-be-careful" : pages.length ? "sleep-first" : "";
}
/** New answers: the matching page shows once more only when it changed (answering again doesn't repeat it). */
export function keepSafetyAnswers(items: SafetyItem[]) {
  const page = pageFor(items), before = pageFor(kept.value.items);
  save({ items, page: page && page !== before ? page : page ? kept.value.page : "" });
}
export function putSafetyPageAway() { save({ ...kept.value, page: "" }); }
