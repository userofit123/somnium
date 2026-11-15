// The safety check's answers (LDJ-116). Which item was a yes is personal health information, so it never leaves this
// device: not to the server, not in exports or backups. Only the outcome syncs, as a plain training preference
// (settings.safety.sleepFirst: no WBTB, CAT or nap suggestions), so every device follows it without knowing why.
// On this device the answers are sealed with the data key, the same way as drafts (api/journal.ts), so they are read
// only while the journal is unlocked, and they are removed with the drafts on sign-out and account removal
// (api/draftStore.ts). Kept per server and person, so two accounts in one browser never see each other's answers.
import { computed, ref, watch } from "vue";
import { sealText, unsealText, type SafetyPage } from "@somnium/shared";
import { readJson, writeJson } from "../../core/prefs";
import { keyring } from "../../core/keyring";
import { session } from "../../core/session";
import { server } from "../../api/client";
import { safetyStoreKey } from "../../api/draftStore";

/** The yes/no items, from Learn's "Who should be careful" (RESEARCH.md Part B §6.2) and "Sleep first" (D1), each with
 *  the sources §6.2 gives for advice before practising (shown when it was a yes). */
export const SAFETY_ITEMS = [
  { id: "sleep", label: "A sleep problem", hint: "Such as insomnia, sleep apnoea or narcolepsy", page: "who-should-be-careful", sources: ["B69"] },
  { id: "mind", label: "Times when waking life feels unreal", hint: "Or psychosis, bipolar disorder, or trouble telling dreams from waking", page: "who-should-be-careful", sources: ["B70", "B71", "B72"] },
  { id: "low", label: "A hard time right now", hint: "Depression, grief or trauma, without someone helping you with it", page: "who-should-be-careful", sources: ["B60", "B73"] },
  { id: "alert", label: "Little room for lost sleep", hint: "Already short on sleep, or shift work or early driving that needs you fully alert", page: "sleep-first", sources: ["B69"] },
] as const satisfies readonly { id: string; label: string; hint: string; page: SafetyPage; sources: readonly string[] }[];
export type SafetyItem = (typeof SAFETY_ITEMS)[number]["id"];

interface Kept { items: SafetyItem[]; /** the page still to show once in "For you"; "" once read or put away */ page: SafetyPage | "" }
const EMPTY: Kept = { items: [], page: "" };
const known = new Set<string>(SAFETY_ITEMS.map((x) => x.id));
const place = () => server.value.base || location.origin;
const aad = (userId: string) => `somnium-safety:${userId}`;
// before the answers were sealed (unreleased builds) they were kept in the clear under this name: sealed and removed
const OLD_KEY = (userId: string) => `somniumSafety:${userId}`;

function clean(v: Partial<Kept> | null): Kept {
  if (!v) return EMPTY;
  return { items: (Array.isArray(v.items) ? v.items : []).filter((x): x is SafetyItem => known.has(x)), page: v.page === "who-should-be-careful" || v.page === "sleep-first" ? v.page : "" };
}

const kept = ref<Kept>(EMPTY);
// Opens the answers whenever the person or the lock changes; while locked nothing is in memory.
async function load() {
  const id = session.user?.id, gen = keyring.generation();
  const key = id ? keyring.get() : null;
  if (!id || !key) { kept.value = EMPTY; key?.fill(0); return; }
  try {
    const old = readJson<Partial<Kept> | null>(OLD_KEY(id), null);
    if (old) { await write(id, clean(old), key); writeJson(OLD_KEY(id), null); }
    const sealed = readJson<string | null>(safetyStoreKey(place(), id), null);
    let v: Kept = EMPTY;
    if (typeof sealed === "string") try { v = clean(JSON.parse(await unsealText(sealed, key, aad(id)))); } catch { v = EMPTY; }
    // the lock or the person moved on while this was opening: the newer load decides
    if (keyring.generation() === gen && session.user?.id === id) kept.value = v;
  } finally { key.fill(0); }
}
async function write(id: string, v: Kept, key: Uint8Array) {
  const k = safetyStoreKey(place(), id);
  writeJson(k, v.items.length || v.page ? await sealText(JSON.stringify(v), key, aad(id)) : null);
}
watch(() => session.user?.id, () => void load(), { immediate: true });
keyring.onChange(() => void load());

function save(v: Kept) {
  kept.value = v;
  const id = session.user?.id, key = id ? keyring.get() : null;
  // only ever written sealed: without the key (never the case behind the lock) the change stays in memory only
  if (id && key) void write(id, v, key).finally(() => key.fill(0));
}

export const safetyAnswers = computed(() => kept.value.items);
export const safetyPage = computed(() => kept.value.page || undefined);

/** The page a set of answers points to: the wider one when any answer is about health, else Sleep first. */
function pageFor(items: readonly SafetyItem[]): SafetyPage | "" {
  const pages = SAFETY_ITEMS.filter((x) => items.includes(x.id)).map((x) => x.page);
  return pages.includes("who-should-be-careful") ? "who-should-be-careful" : pages.length ? "sleep-first" : "";
}
/** New answers: the matching page shows once more only when it changed (answering again doesn't repeat it). */
export function keepSafetyAnswers(items: SafetyItem[]) {
  const page = pageFor(items), before = pageFor(kept.value.items);
  save({ items, page: page && page !== before ? page : page ? kept.value.page : "" });
}
export function putSafetyPageAway() { save({ ...kept.value, page: "" }); }
