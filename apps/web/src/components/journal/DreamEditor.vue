<script setup lang="ts">
// Writing a dream (PLAN.md §6.2): full screen on the phone, opening with the keyboard; a side panel on a computer.
// Every change is saved as it is made (api/journal.ts says where a draft waits), so the lock, a reload or a lost
// connection never costs a word. Saving is quiet: a word in the corner, never a toast.
// Done on a new dream (or one finished from the morning's key words) first shows what it holds for the dream signs
// (InThisDream, LDJ-110), and a milestone's moment when the dream reaches one (Milestone, LDJ-117): in the editor, so
// the lock takes them away with it, and once only.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { addAlias, elementMatches, fold, mergeDraft, parseDismissed, mergeLinks, nightOfDate, ELEMENT_KIND_LABEL, NEW_ELEMENT_KINDS, CONTROL_ANCHORS, DSA_ANCHORS, EMOTION_ANCHORS, LUCIDITY_ANCHORS, RECALL_ANCHORS, VIVIDNESS_ANCHORS, UPSET_HINT, UPSET_SOURCES, BECAME_LUCID_LABEL, BECAME_LUCID_ORDER, LUCID_ENDS, LUCID_END_LABEL, LUCID_LENGTHS, LUCID_SOURCES, lucidLength, dueMilestones, milestonesSeen, MILESTONE_HOW, nightRecipe, pairedCheck, signsInDream, IN_DREAM_MAX, type Element, type MilestoneId, type SignCategory, type Suggestion } from "@somnium/shared";
import { api, ApiError } from "../../api/client";
import { beginDraft, changeDream, deleteDream, draftBusy, endDraft, flagElement, linkElement, madeInDraft, teachAlias, liveDraft, openStored, saveError, saveNow, saveState, unlinkElement, useJournal, uuidv7, type DreamFull, type NightRow } from "../../api/journal";
import { localYmd, useFmt } from "../../core/format";
import { confirm } from "../../core/ask";
import { readHardSeen, readSignsShown, rememberSignsShown, writeHardSeen } from "../../core/seenOnDevice";
import { toastError } from "../../core/toast";
import { saveSettings, useSettings } from "../../api/queries";
import { loadSignLexicons, setElementFlags, signLexicons } from "../../api/signs";
import Icon from "../Icon.vue";
import { useRouter } from "vue-router";
import { backLabel } from "../../core/leave";
import Menu from "../Menu.vue";
import Collapse from "../Collapse.vue";
import NightSheet from "./NightSheet.vue";
import DreamMedia from "./DreamMedia.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import CiteChips from "../learn/CiteChips.vue";
import "../../styles/components/learn.css";
import { loadLexicons, suggestElements, suggestKind } from "./detect";
import InThisDream, { type InDreamRow } from "./InThisDream.vue";
import Milestone from "./Milestone.vue";
import HardNightNote, { HARD_NOTES, type HardKind } from "./HardNightNote.vue";

// fresh: a dream started here just now (a new id), so not reaching the server can't mean writing over one there
const props = defineProps<{ id: string; date?: string; full?: boolean; fresh?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const backText = props.full ? backLabel(useRouter(), "Journal") : "";
const j = useJournal();
const fmt = useFmt();

const FIELDS = ["title", "text", "lucid", "lucidityLevel", "awareness", "vividness", "control", "recallClarity", "emotionOverall", "nightmare", "badDream", "recurring", "falseAwakening", "sleepParalysis", "favourite", "dismissed", "becameLucidHow", "lucidTrigger", "durationEst", "lucidEnd", "unfinished"] as const;
const f = reactive<Record<string, any>>({ title: "", text: "", lucid: false, lucidityLevel: 0, awareness: null, vividness: null, control: null, recallClarity: null, emotionOverall: null, nightmare: false, badDream: false, recurring: false, falseAwakening: false, sleepParalysis: false, favourite: false, dismissed: null, becameLucidHow: null, lucidTrigger: null, durationEst: null, lucidEnd: null, unfinished: false });
const where = reactive({ date: props.date ?? localYmd(new Date()), nap: false, nightId: "" });
const chosen = ref<string[]>([]);
const made = ref<(Pick<Element, "id" | "name" | "kind" | "aliases"> & Partial<Pick<Element, "isDreamSign" | "signCategory">>)[]>([]);
const ready = ref(false), loadError = ref(""), more = ref(false), nightOpen = ref(false), existed = ref(false);
const textEl = ref<HTMLTextAreaElement | null>(null);
// an unfinished dream's key words (the capture saves them comma-separated on one line), each offered as a prompt until
// a line has been added for it; read from the decrypted draft here only, kept in memory
const prompts = ref<string[]>([]);

async function load() {
  let row: DreamFull | null = null;
  try { row = await api.get<DreamFull>(`/dreams/${props.id}`); }
  catch (e) { if (!(e instanceof ApiError && e.status === 404) && !props.fresh) loadError.value = e instanceof Error ? e.message : "Couldn't open this dream"; }
  const live = liveDraft(props.id), stored = live ? null : await openStored(props.id), draft = live ?? stored;
  // can't read the dream as it is now and nothing kept here: writing over it blind could undo it
  if (loadError.value && !draft) return;
  loadError.value = "";
  existed.value = !!row;
  // a dream written now, or the morning's key words being written out, is new to the person's sign list
  // (and only once per dream: a new dream reopened while it is still a draft kept here has no row either)
  signsDue.value = (!row || !!row.unfinished) && !signsShown().includes(props.id);
  const m = mergeDraft(row as any, draft);
  for (const k of FIELDS) if (m[k] !== undefined && m[k] !== null) f[k] = m[k];
  chosen.value = mergeLinks((row?.elements ?? []).map((l) => l.elementId), draft);
  made.value = draft?.newElements.map((e) => ({ id: e.id, name: e.name, kind: e.kind as Element["kind"], aliases: e.aliases ?? null })) ?? [];
  const nights: NightRow[] = j.nights.data.value ?? (await api.get<NightRow[]>("/nights").catch(() => []));
  const night = nights.find((n) => n.id === m.nightId);
  if (draft) Object.assign(where, { date: draft.date, nap: draft.nap, nightId: draft.nightId });
  else if (night) Object.assign(where, { date: night.date, nap: night.nap, nightId: night.id });
  else where.nightId = nightOfDate(nights, where.date)?.id ?? uuidv7();
  if (!liveDraft(props.id)) beginDraft(draft ?? { dreamId: props.id, nightId: where.nightId, date: where.date, nap: where.nap, dream: {}, night: {}, link: [], unlink: [], newElements: [], savedAt: row?.updatedAt ? Date.parse(row.updatedAt) : 0 });
  const t = String(f.text ?? "");
  prompts.value = f.unfinished && t.trim() && !t.includes("\n") ? [...new Set(t.split(",").map((w) => w.trim()).filter(Boolean))].slice(0, 12) : [];
  await nextTick();
  ready.value = true;
  // a draft kept here that the server hasn't got yet goes now
  if (stored || (live && saveState[props.id] && saveState[props.id] !== "saved")) changeDream(props.id, pick());
}
const pick = () => Object.fromEntries(FIELDS.map((k) => [k, f[k]]));

watch(f, () => { if (ready.value) changeDream(props.id, pick()); }, { deep: true });
// key words saved from the morning capture with "Later" (LDJ-80): writing on from them here finishes the dream
watch(() => f.text, () => { if (ready.value && f.unfinished) f.unfinished = false; });
// a level of lucidity means it was lucid; not lucid means level 0; marking lucid takes the lowest lucid step so the
// two never disagree (a dream marked Lucid with level 0 would read "Not lucid")
watch(() => f.lucidityLevel, (v) => { if (v > 0 && !f.lucid) f.lucid = true; });
watch(() => f.lucid, (v) => { if (!v && f.lucidityLevel) f.lucidityLevel = 0; else if (v && !f.lucidityLevel) f.lucidityLevel = 1; });

const vivid = computed(() => (f.vividness ?? 0) >= 4);
const CHIPS = [
  { k: "lucid", label: "Lucid" }, { k: "vivid", label: "Vivid" }, { k: "badDream", label: "Bad dream" }, { k: "nightmare", label: "Nightmare" }, { k: "recurring", label: "Recurring" },
  { k: "falseAwakening", label: "False awakening" }, { k: "sleepParalysis", label: "Sleep paralysis" },
];
const chipOn = (k: string) => (k === "vivid" ? vivid.value : !!f[k]);
// Bad dream or Nightmare: whether it woke you (RESEARCH.md C18). One or the other, so marking one clears the
// other, and while either is on a line under the marks says which is which.
const UPSET = { nightmare: "badDream", badDream: "nightmare" } as Record<string, string>;
const upset = computed(() => !!(f.nightmare || f.badDream));
const sourcesOpen = ref<string[] | null>(null);
function toggleChip(k: string) {
  if (k === "vivid") f.vividness = vivid.value ? null : 4;
  else {
    f[k] = !f[k];
    const other = UPSET[k];
    if (other && f[k]) f[other] = false;
    if (f[k]) offerHardNote(k === "badDream" ? "nightmare" : (k as HardKind));
  }
}
// Marking sleep paralysis, a false awakening or a frightening dream brings a calm note under the marks (LDJ-158):
// the first time, then at most once a month for each, and for the same dream again however often it is toggled.
// Kept on this device: the kind, when, and the dream's id, nothing of what it says.
const MONTH = 30 * 864e5;
const hardOffered = ref<HardKind[]>([]);
function offerHardNote(k: HardKind) {
  if (!(k in HARD_NOTES) || hardOffered.value.includes(k)) return;
  const seen = readHardSeen();
  const last = seen[k];
  if (last && last.dream !== props.id && Date.now() - last.at < MONTH) return;
  hardOffered.value.push(k);
  writeHardSeen({ ...seen, [k]: { at: last?.dream === props.id ? last.at : Date.now(), dream: props.id } });
}
const hardOn = (k: HardKind) => (k === "nightmare" ? upset.value : !!f[k]);
const hardShown = computed(() => hardOffered.value.filter(hardOn));
// a lucid dream's own questions (LDJ-78): one tap picks, a second tap on the same chip clears
const pickOne = (k: string, v: string | number) => { f[k] = f[k] === v ? null : v; };
const lucidLen = computed(() => lucidLength(f.durationEst));
const set = (k: string, v: number) => {
  f[k] = f[k] === v ? (k === "lucidityLevel" ? 0 : null) : v;
  if (k === "lucidityLevel" && !f[k]) f.lucid = false; // level 0 is "Not lucid"
};

// elements: type-ahead from the person's own, or a new one
const all = computed(() => [...(j.elements.data.value ?? []), ...made.value.filter((m) => !(j.elements.data.value ?? []).some((e) => e.id === m.id))]);
const chosenEls = computed(() => chosen.value.map((id) => all.value.find((e) => e.id === id)).filter((e): e is NonNullable<typeof e> => !!e));
const typed = ref(""), hi = ref(0);
const matches = computed(() => elementMatches(all.value, typed.value, chosen.value, 6));
const exact = computed(() => all.value.some((e) => e.name && fold(e.name) === fold(typed.value.trim())));
function addEl(id: string) { chosen.value.push(id); linkElement(props.id, id); typed.value = ""; hi.value = 0; }
// a new element's kind is picked in the create row; it starts as a character (what people note most, and the
// placeholder's first word) and then stays at the kind picked last while this dream is open
const newKind = ref<(typeof NEW_ELEMENT_KINDS)[number]>("character");
// until the person picks a kind themselves, the typed name decides it (LDJ-68); no suggestion keeps the current kind
let kindPicked = false;
watch(typed, (n) => {
  if (!n.trim()) { kindPicked = false; return; }
  if (kindPicked) return;
  const k = suggestKind(n, own.value);
  if (k) newKind.value = k as typeof newKind.value;
});
function createEl() {
  const name = typed.value.trim();
  if (!name) return;
  const id = uuidv7(), kind = newKind.value;
  made.value.push({ id, name, kind, aliases: null });
  chosen.value.push(id);
  linkElement(props.id, id, { name, kind });
  typed.value = "";
  kindPicked = false;
}
const onCreate = computed(() => !exact.value && hi.value === matches.value.length);
function stepKind(by: number) { kindPicked = true; const i = NEW_ELEMENT_KINDS.indexOf(newKind.value); newKind.value = NEW_ELEMENT_KINDS[(i + by + NEW_ELEMENT_KINDS.length) % NEW_ELEMENT_KINDS.length]!; }
function onElKey(e: KeyboardEvent) {
  // on the create row, left and right pick its kind
  if (onCreate.value && (e.key === "ArrowLeft" || e.key === "ArrowRight") && typed.value.trim()) { stepKind(e.key === "ArrowLeft" ? -1 : 1); e.preventDefault(); }
  else if (e.key === "ArrowDown") { hi.value = Math.min(hi.value + 1, matches.value.length); e.preventDefault(); }
  else if (e.key === "ArrowUp") { hi.value = Math.max(hi.value - 1, 0); e.preventDefault(); }
  else if (e.key === "Enter") { e.preventDefault(); const m = matches.value[hi.value]; if (m) addEl(m.id); else if (!exact.value) createEl(); }
}
function removeEl(id: string) { chosen.value = chosen.value.filter((x) => x !== id); unlinkElement(props.id, id); }
// "the app reads your dream" (PLAN.md §7.1): suggestions from the text, read on this device a moment after the
// writing pauses, so typing never waits on it
const readText = ref("");
let readTimer: ReturnType<typeof setTimeout> | undefined;
watch(() => f.text, (t) => { clearTimeout(readTimer); readTimer = setTimeout(() => (readText.value = t ?? ""), 600); });
const dismissedKeys = computed(() => parseDismissed(f.dismissed));
const own = computed(() => all.value.map((e) => ({ id: e.id, name: e.name, kind: e.kind, aliases: e.aliases ?? null })));
const suggested = computed(() => suggestElements(readText.value, own.value, chosen.value, dismissedKeys.value));
// the words the dream used for it, as written, when they are not the element's name already
function saidAs(s: Suggestion, name: string | null, aliases: string | null): string | null {
  if (s.type !== "element") return null;
  const bare = (x: string) => fold(x).replace(/^(?:my|the|a|an) /, "").replace(/s$/, "");
  let out = aliases;
  for (const [a, b] of s.spans) {
    const w = (f.text ?? "").slice(a, b).trim();
    if (!w || w.split(/\s+/).length > 3 || [name ?? "", ...(out ?? "").split(",")].some((x) => x.trim() && bare(x) === bare(w))) continue;
    out = addAlias({ name, aliases: out }, w.toLowerCase()) ?? out;
  }
  return out === aliases ? null : out;
}
/** One tap: links the person's element, or makes it, marked as found in the text with where and how sure. */
function confirmSug(s: Suggestion) {
  const meta = { source: "detected" as const, confidence: s.confidence, span: JSON.stringify(s.spans) };
  const el = s.existingElementId ? all.value.find((e) => e.id === s.existingElementId) : undefined;
  if (el) {
    chosen.value.push(el.id);
    linkElement(props.id, el.id, undefined, meta);
    // found under another name ("mom" for Mother): the element answers to that name from now on
    const taught = saidAs(s, el.name, el.aliases ?? null);
    if (taught) {
      teachAlias(props.id, el.id, taught);
      const m = made.value.find((x) => x.id === el.id); if (m) m.aliases = taught; else el.aliases = taught;
    }
    return;
  }
  const id = uuidv7(), aliases = saidAs(s, s.name, null);
  made.value.push({ id, name: s.name, kind: s.kind, aliases, ...(s.type === "sign" ? { isDreamSign: true, signCategory: s.signCategory ?? null } : {}) });
  chosen.value.push(id);
  linkElement(props.id, id, { name: s.name, kind: s.kind, aliases, ...(s.type === "sign" ? { isDreamSign: true, signCategory: s.signCategory ?? null } : {}) }, meta);
}
/** Not this one, for this dream: kept with the dream (sealed), so it stays gone after a reload and on other devices. */
function dismissSug(s: Suggestion) { f.dismissed = JSON.stringify([...dismissedKeys.value, s.key]); }

/** A prompt tapped: a line for that key word under the text, the cursor after it, and the prompt is done. */
function promptLine(w: string) {
  const now = (f.text ?? "").trimEnd();
  f.text = `${now}${now.includes("\n") ? "\n" : "\n\n"}${w}: `;
  prompts.value = prompts.value.filter((x) => x !== w);
  void nextTick(() => { const t = textEl.value; if (!t) return; t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length); t.scrollTop = t.scrollHeight; });
}
// the checked text of a photographed page goes at the end of the dream, and is read for elements like typed text
function addText(t: string) { const now = (f.text ?? "").trimEnd(); f.text = now ? `${now}\n\n${t}` : t; }

const state = computed(() => saveState[props.id]);
const stateText = computed(() => ({ saving: "Saving", saved: "Saved", waiting: "Kept on this device · sends when the server is back", error: saveError[props.id] ?? "Couldn't save" } as Record<string, string>)[state.value ?? ""] ?? "");

// ---------- right after saving (LDJ-110, LDJ-117) ----------
const settings = useSettings();
const signsDue = ref(false), after = ref(false), milestone = ref<MilestoneId | null>(null);
const signRows = ref<InDreamRow[]>([]);
const pending = new Map<string, Suggestion>();
const checkFor = (c: SignCategory | null | undefined) => pairedCheck(c ?? null, signLexicons.value?.checks ?? [])?.name ?? null;
const night = computed(() => (j.nights.data.value ?? []).find((n) => n.id === where.nightId));
const howLabel = computed(() => (f.becameLucidHow ? MILESTONE_HOW[f.becameLucidHow] ?? null : null));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// the dreams "In this dream" was shown for, on this device: ids only, nothing of what they say; the newest few hundred
const signsShown = readSignsShown, rememberShown = rememberSignsShown;

/** The milestone this dream reaches, recorded as seen at once so no other screen or device shows it again. */
function findMilestone() {
  const facts = j.facts.data.value, nights = j.nights.data.value;
  // without the journal's lists it can't be known to be a first: say nothing rather than something wrong
  if (!facts || !nights || !f.lucid) return;
  const due = dueMilestones({ id: props.id, nightId: where.nightId, lucid: f.lucid, lucidityLevel: f.lucidityLevel, becameLucidHow: f.becameLucidHow }, facts, nights, settings.value.milestones, settings.value.setup?.experience);
  if (!due.length) return;
  milestone.value = due[0]!;
  void saveSettings({ milestones: milestonesSeen(due, props.id, localYmd(new Date())) }, { quiet: true });
}
/** The person's signs that came back, then up to three sign-like things to mark: linked ones, then ones only found. */
function findSigns() {
  if (!signsDue.value || !(f.text ?? "").trim()) return;
  const linked = chosenEls.value.map((e) => ({ id: e.id, kind: e.kind, name: e.name, aliases: e.aliases ?? null, isDreamSign: !!e.isDreamSign, signCategory: e.signCategory ?? null, confirmed: true }));
  const dreams = (j.facts.data.value ?? []).map((d) => ({ id: d.id, date: d.date, lucid: d.lucid }));
  const r = signsInDream(props.id, linked, j.links.data.value ?? [], dreams);
  const rows: InDreamRow[] = [
    ...r.known.map((k) => ({ key: `e:${k.element.id}`, name: k.element.name ?? "", seen: k.seen, lucidBefore: k.lucidBefore, check: checkFor(k.element.signCategory), marked: false })),
    ...r.offer.map((e) => ({ key: `e:${e.id}`, name: e.name ?? "", check: checkFor(e.signCategory), marked: false })),
  ];
  for (const s of suggestElements(f.text ?? "", own.value, chosen.value, dismissedKeys.value)) {
    if (s.type !== "sign" || rows.length - r.known.length >= IN_DREAM_MAX) continue;
    pending.set(`s:${s.key}`, s);
    rows.push({ key: `s:${s.key}`, name: s.name, check: checkFor(s.signCategory), marked: false });
  }
  signRows.value = rows;
}
async function markSign(key: string) {
  const row = signRows.value.find((r) => r.key === key);
  if (!row || row.marked) return;
  row.marked = true;
  try {
    const s = pending.get(key);
    // only found in the text: made (or linked) through the draft, like a tap on the suggestion
    if (s && !s.existingElementId) { confirmSug(s); return; }
    if (s) confirmSug(s);
    const id = s?.existingElementId ?? key.slice(2);
    // only an element the server is known to have takes the mark straight away (queued when offline); one that may
    // still be on its way goes with the draft, which sends the mark after making it, so the two never race
    const onServer = (j.elements.data.value ?? []).some((e) => e.id === id) && !madeInDraft(props.id, id);
    if (onServer || !flagElement(props.id, id, { isDreamSign: true })) await setElementFlags(id, { isDreamSign: true, confirmed: true });
  } catch (e) { row.marked = false; toastError(e); }
}

async function done() {
  if (after.value || !ready.value || loadError.value) return close();
  saveNow(props.id);
  findMilestone();
  findSigns();
  if (!milestone.value && !signRows.value.length) return close();
  // what was just written goes first, so a sign marked next is made after it (or with it)
  for (let i = 0; i < 20 && draftBusy(props.id); i++) await wait(100);
  after.value = true;
  if (signRows.value.length) rememberShown(props.id);
  await nextTick();
  (document.querySelector(".jed.jfull") as HTMLElement | null)?.scrollTo({ top: 0 });
}
function close() { saveNow(props.id); endDraft(props.id); emit("close"); }
async function remove() {
  if (!(await confirm("Delete this dream?", { ok: "Delete", danger: true }))) return;
  try { await deleteDream(props.id); emit("close"); } catch (e) { toastError(e); }
}
const menu = computed(() => [
  { label: "Night details", icon: "moon", run: () => (nightOpen.value = true) },
  { label: f.favourite ? "Not a favourite" : "Favourite", icon: "star", run: () => (f.favourite = !f.favourite) },
  { label: "Delete dream", icon: "trash", danger: true, run: remove, hidden: !existed.value && !state.value },
]);

const grow = () => { const t = textEl.value; if (!t || props.full) return; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; };
watch(() => f.text, () => nextTick(grow));
onMounted(async () => {
  await load();
  readText.value = f.text ?? "";
  await nextTick(); grow();
  // after the first paint: the lexicons are a separate chunk, read only once there is a dream to read
  setTimeout(() => { void loadLexicons(); void loadSignLexicons(); }, 0);
  // the keyboard opens on the text, with the date and title still in view above it
  if (props.full && ready.value && !f.text) textEl.value?.focus({ preventScroll: true });
});
// the lock unmounts this: what is waiting goes now (the device copy needs no key; the direct path sealed it already)
const leaving = () => saveNow(props.id);
addEventListener("pagehide", leaving);
onBeforeUnmount(() => { clearTimeout(readTimer); removeEventListener("pagehide", leaving); saveNow(props.id); endDraft(props.id); });
</script>

<template>
  <div class="jed" :class="{ jfull: full }">
    <!-- phone: the page header every page has, Back saving and closing like Done; computer: a bar atop the side panel -->
    <div v-if="full" class="ph">
      <div><button type="button" class="back" @click="done"><Icon name="left" :size="16" /><span>{{ backText }}</span></button>
        <h1>{{ fresh ? "Write a dream" : "Edit dream" }}</h1>
        <div class="sub jst" :class="{ err: state === 'error' }" aria-live="polite">{{ stateText }}</div></div>
      <div class="acts"><Menu v-if="!after" :items="menu" /><button class="btn keep" @click="done">Done</button></div>
    </div>
    <div v-else class="jbar">
      <button class="ib sm plain" aria-label="Close" @click="done"><Icon name="close" :size="18" /></button>
      <div class="grow jst tiny" :class="{ err: state === 'error' }" aria-live="polite">{{ stateText }}</div>
      <Menu v-if="!after" :items="menu" />
      <button class="btn" @click="done">Done</button>
    </div>
    <div v-if="loadError" class="card empty sm"><Icon name="book" :size="34" /><b>Couldn't open this dream</b>{{ loadError }}<br /><button class="btn tonal" type="button" @click="emit('close')">Back to the journal</button></div>
    <template v-else-if="after">
      <Milestone v-if="milestone" :id="milestone" :how="howLabel" :trigger="f.lucidTrigger" :recipe="nightRecipe(night)" @lesson="close" />
      <InThisDream v-if="signRows.length" :rows="signRows" @mark="markSign" />
    </template>
    <template v-else-if="ready">
      <button class="qb jnight" @click="nightOpen = true"><Icon name="moon" :size="16" />{{ fmt.date(where.date, { weekday: "long", day: "numeric", month: "long" }) }}{{ where.nap ? " · Nap" : "" }}<span class="muted" aria-hidden="true">·</span><span class="muted">Night details</span></button>
      <input v-model="f.title" class="jtitle" placeholder="Title" maxlength="200" />
      <p v-if="f.unfinished" class="tiny muted" style="margin:0">Saved as key words this morning. Write it out while some of it is still there.</p>
      <div v-if="prompts.length" class="jprompts" role="group" aria-label="Key words to write out">
        <div class="tiny muted">Each key word: what happened there? Tap one to add a line for it.</div>
        <div class="chips jopts">
          <button v-for="w in prompts" :key="w" type="button" class="fchip" :aria-label="'Add a line for ' + w" @click="promptLine(w)"><Icon name="plus" :size="12" />{{ w }}</button>
        </div>
      </div>
      <textarea ref="textEl" v-model="f.text" class="jtext" placeholder="I am standing in a house I don't know. The light is strange..." />
      <div v-if="suggested.length" class="jfound" aria-label="Found in the text">
        <span v-for="s in suggested" :key="s.key" class="jsg">
          <button class="jsgo" :aria-label="'Add ' + s.name" @click="confirmSug(s)"><Icon name="plus" :size="12" />{{ s.name }}<span class="jkind">{{ ELEMENT_KIND_LABEL[s.kind] }}</span></button>
          <button class="jx" :aria-label="'Not ' + s.name" @click="dismissSug(s)"><Icon name="close" :size="12" /></button>
        </span>
      </div>

      <DreamMedia :dream-id="id" edit @text="addText" />

      <div class="chips jchips">
        <button v-for="c in CHIPS" :key="c.k" class="fchip" :class="{ on: chipOn(c.k) }" :aria-pressed="chipOn(c.k)" @click="toggleChip(c.k)">{{ c.label }}</button>
      </div>
      <div v-if="upset" class="tiny jupset">{{ UPSET_HINT }} <CiteChips :ids="UPSET_SOURCES" @cite="sourcesOpen = $event" /></div>
      <HardNightNote v-if="hardShown.length" :kinds="hardShown" @learn="close" />
      <SourceSheet v-if="sourcesOpen" :ids="sourcesOpen" @close="sourcesOpen = null" />

      <div class="fld">
        <label>Lucidity</label>
        <div class="seg jscale" role="group" aria-label="Lucidity"><button v-for="n in 6" :key="n" type="button" :class="{ on: f.lucidityLevel === n - 1 }" :aria-pressed="f.lucidityLevel === n - 1" @click="set('lucidityLevel', n - 1)">{{ n - 1 }}</button></div>
        <div class="tiny jan">{{ LUCIDITY_ANCHORS[f.lucidityLevel ?? 0] }}</div>
      </div>
      <div v-if="f.lucid" class="jlucid" role="group" aria-label="Your lucid dream">
        <div class="jlh">Your lucid dream</div>
        <div class="tiny jan0">Which way gets you lucid shows you what to train. <CiteChips :ids="LUCID_SOURCES" @cite="sourcesOpen = $event" /></div>
        <div class="fld">
          <label>How did you know?</label>
          <div class="chips jopts" role="radiogroup" aria-label="How did you know?">
            <button v-for="h in BECAME_LUCID_ORDER" :key="h" type="button" class="fchip" :class="{ on: f.becameLucidHow === h }" role="radio" :aria-checked="f.becameLucidHow === h" @click="pickOne('becameLucidHow', h)">{{ BECAME_LUCID_LABEL[h] }}</button>
          </div>
          <input v-model="f.lucidTrigger" class="jtrig" placeholder="What tipped you off? (optional)" maxlength="200" aria-label="What tipped you off" />
        </div>
        <div class="fld">
          <label>About how long were you lucid?</label>
          <div class="chips jopts" role="radiogroup" aria-label="About how long were you lucid?">
            <button v-for="l in LUCID_LENGTHS" :key="l.key" type="button" class="fchip" :class="{ on: lucidLen === l.key }" role="radio" :aria-checked="lucidLen === l.key" @click="f.durationEst = lucidLen === l.key ? null : l.minutes">{{ l.label }}</button>
          </div>
        </div>
        <div class="fld">
          <label>How did it end?</label>
          <div class="chips jopts" role="radiogroup" aria-label="How did it end?">
            <button v-for="e in LUCID_ENDS" :key="e" type="button" class="fchip" :class="{ on: f.lucidEnd === e }" role="radio" :aria-checked="f.lucidEnd === e" @click="pickOne('lucidEnd', e)">{{ LUCID_END_LABEL[e] }}</button>
          </div>
        </div>
      </div>
      <div class="fld">
        <label>Vividness</label>
        <div class="seg jscale" role="group" aria-label="Vividness"><button v-for="n in 5" :key="n" type="button" :class="{ on: f.vividness === n }" :aria-pressed="f.vividness === n" @click="set('vividness', n)">{{ n }}</button></div>
        <div class="tiny jan">{{ f.vividness ? VIVIDNESS_ANCHORS[f.vividness - 1] : "Not set" }}</div>
      </div>

      <div class="fld">
        <label>Elements</label>
        <div v-if="chosenEls.length" class="chips jels">
          <span v-for="e in chosenEls" :key="e.id" class="fchip on">{{ e.name }}<button class="jx" :aria-label="'Remove ' + e.name" @click="removeEl(e.id)"><Icon name="close" :size="12" /></button></span>
        </div>
        <div class="jta">
          <input v-model="typed" placeholder="Add a person, place, thing..." maxlength="80" @keydown="onElKey" @input="hi = 0" />
          <div v-if="typed.trim()" class="card jsug">
            <div class="list">
              <button v-for="(m, i) in matches" :key="m.id" class="li click" :class="{ hi: hi === i }" @mousedown.prevent="addEl(m.id)"><span class="grow">{{ m.name }}</span><span class="tiny">{{ ELEMENT_KIND_LABEL[m.kind] ?? m.kind }}</span></button>
              <div v-if="!exact" class="jnew" :class="{ hi: onCreate }">
                <button class="li click" @mousedown.prevent="createEl"><Icon name="plus" :size="14" /><span class="grow">New {{ ELEMENT_KIND_LABEL[newKind].toLowerCase() }}: {{ typed.trim() }}</span></button>
                <div class="chips jkinds" role="radiogroup" aria-label="Kind of element">
                  <button v-for="k in NEW_ELEMENT_KINDS" :key="k" class="fchip" :class="{ on: newKind === k }" role="radio" :aria-checked="newKind === k" @mousedown.prevent="newKind = k; kindPicked = true">{{ ELEMENT_KIND_LABEL[k] }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <button class="qb jmore" :aria-expanded="more" @click="more = !more"><Icon :name="more ? 'up' : 'down'" :size="16" />More</button>
      <Collapse :open="more">
        <div class="fld">
          <label>Control</label>
          <div class="seg jscale" role="group" aria-label="Control"><button v-for="n in 6" :key="n" type="button" :class="{ on: f.control === n - 1 }" :aria-pressed="f.control === n - 1" @click="set('control', n - 1)">{{ n - 1 }}</button></div>
          <div class="tiny jan">{{ f.control != null ? CONTROL_ANCHORS[f.control] : "Not set" }}</div>
        </div>
        <div class="fld">
          <label>Dreamsign awareness</label>
          <div class="seg jscale" role="group" aria-label="Dreamsign awareness"><button v-for="n in 5" :key="n" type="button" :class="{ on: f.awareness === n - 1 }" :aria-pressed="f.awareness === n - 1" @click="set('awareness', n - 1)">{{ n - 1 }}</button></div>
          <div class="tiny jan">{{ f.awareness != null ? DSA_ANCHORS[f.awareness] : "Not set · how aware you were of a dreamsign in this dream" }}</div>
        </div>
        <div class="fld">
          <label>Recall clarity</label>
          <div class="seg jscale" role="group" aria-label="Recall clarity"><button v-for="n in 5" :key="n" type="button" :class="{ on: f.recallClarity === n }" :aria-pressed="f.recallClarity === n" @click="set('recallClarity', n)">{{ n }}</button></div>
          <div class="tiny jan">{{ f.recallClarity ? RECALL_ANCHORS[f.recallClarity - 1] : "Not set" }}</div>
        </div>
        <div class="fld">
          <label>Overall emotion</label>
          <div class="seg jscale" role="group" aria-label="Overall emotion"><button v-for="n in 5" :key="n" type="button" :class="{ on: f.emotionOverall === n - 3 }" :aria-pressed="f.emotionOverall === n - 3" @click="set('emotionOverall', n - 3)">{{ n - 3 > 0 ? "+" + (n - 3) : n - 3 }}</button></div>
          <div class="tiny jan">{{ f.emotionOverall != null ? EMOTION_ANCHORS[f.emotionOverall + 2] : "Not set" }}</div>
        </div>
      </Collapse>
    </template>
    <NightSheet v-if="nightOpen" :dream-id="id" :date="where.date" :nap="where.nap" :night-id="where.nightId" @moved="(d, n, id2) => Object.assign(where, { date: d, nap: n, nightId: id2 })" @close="nightOpen = false" />
  </div>
</template>

<style scoped>
.jed { display: flex; flex-direction: column; gap: var(--lpy); min-width: 0; }
.jfull { position: fixed; inset: 0; z-index: 100; background: var(--bg); overflow-y: auto; overscroll-behavior: contain; padding: calc(var(--st) + var(--hg)) calc(var(--sr) + var(--hg)) calc(var(--sb) + var(--spg)) calc(var(--sl) + var(--hg)); }
.jbar { display: flex; align-items: center; gap: calc(var(--lpy) * .8); }
.jfull .ph { position: sticky; top: calc(-1 * (var(--st) + var(--hg))); background: var(--bg); padding: var(--hg) 0; margin-top: calc(-1 * var(--hg)); margin-bottom: 0; z-index: 2; align-items: center; }
.jst { color: var(--tx2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jst.err { color: var(--neg); }
.jnight { align-self: flex-start; padding-left: 0; }
.jtitle { font-size: calc(18px * var(--fsc)); font-weight: 600; }
.jtext { min-height: 180px; resize: vertical; font-size: var(--fs-lg); line-height: 1.55; }
.jfull .jtext { min-height: 42vh; }
.jchips { margin: 0; }
.jprompts { display: flex; flex-direction: column; gap: var(--tdy); }
.jprompts .fchip { gap: var(--tdy); }
.jupset { color: var(--tx2); margin-top: calc(-1 * var(--tdy)); }
/* suggestions: quiet, so they read as an offer and not as part of the dream */
.jfound { display: flex; flex-wrap: wrap; gap: var(--tdy); margin-top: calc(-1 * var(--tdy)); }
.jsg { display: inline-flex; align-items: center; gap: var(--tdy); border: 1px dashed var(--ol); border-radius: var(--pill); padding: 2px 8px 2px 4px; color: var(--tx2); font-size: var(--fs-sm); max-width: 100%; }
.jsgo { display: inline-flex; align-items: center; gap: var(--tdy); border: 0; background: none; color: var(--tx); font: inherit; padding: 2px 4px; cursor: pointer; min-width: 0; text-align: start; }
.jsgo:hover, .jsgo:focus-visible { color: var(--acc); }
.jkind { color: var(--tx2); font-size: var(--fs-xs); margin-left: 2px; }
.jsg .jx { color: var(--tx2); padding: 2px; }
.jscale { display: flex; width: 100%; }
.jscale button { flex: 1; min-width: 0; }
.jan { margin-top: var(--tdy); color: var(--tx2); }
.jels { margin-bottom: calc(var(--lpy) * .8); }
.jels .fchip { gap: var(--tdy); }
.jx { border: 0; background: none; color: inherit; padding: 0; display: inline-grid; place-items: center; cursor: pointer; }
.jta { position: relative; }
.jsug { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5; padding: var(--tdy) var(--cpx); }
.jsug .li { width: 100%; background: none; border-left: 0; border-right: 0; border-top: 0; color: var(--tx); text-align: start; font: inherit; }
.jsug .li.hi, .jnew.hi { background: var(--s2); }
.jnew .li { background: none; }
.jkinds { margin: 0; padding: 0 0 var(--lpy); }
/* a lucid dream's own questions sit under the lucidity scale, set in from the left so they read as part of it */
.jlucid { display: flex; flex-direction: column; gap: var(--lpy); padding-left: var(--lpy); border-left: 2px solid var(--accc); }
.jlh { font-weight: 600; }
.jan0 { color: var(--tx2); margin-top: calc(-1 * var(--tdy)); }
.jopts { margin: 0; }
.jtrig { margin-top: calc(var(--lpy) * .8); width: 100%; }
.jmore { align-self: flex-start; padding-left: 0; }
.fld { margin-bottom: 0; }
</style>
