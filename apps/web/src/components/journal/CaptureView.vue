<script setup lang="ts">
// The morning capture (LDJ-80): what the morning reminder, the WBTB alarm, Home's "Write last night's dream" and the
// phone's + open. Half asleep, the dream fades in the first minute, so: first a still moment on the dim night
// surface (lie still, ask what you were dreaming, rebuild it backwards), then key words, each one a chip, and the
// marks that take one tap. "Write it out" goes on to the editor with the words at the top; "Later" keeps them as the
// dream and marks it unfinished (RESEARCH.md C1, C2). It saves as you type through the editor's own draft (sealed
// on this device, sent or kept for later, api/journal.ts), and App.vue draws it only behind the lock.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { clockOf, nightOfDate, wakeStamp } from "@somnium/shared";
import { api, ApiError } from "../../api/client";
import { beginDraft, changeDream, deleteDream, dropLocalDraft, endDraft, liveDraft, markNoRecall, openStored, saveError, saveNow, saveState, useJournal, uuidv7, type DreamFull, type NightRow } from "../../api/journal";
import { useSettings } from "../../api/queries";
import { useDreamMedia, type MediaRow } from "../../api/media";
import { localYmd } from "../../core/format";
import { goBack } from "../../core/leave";
import { vTrap } from "../../core/focusTrap";
import Icon from "../Icon.vue";
import Ev from "../train/guided/Ev.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import DreamMedia from "./DreamMedia.vue";
import "../../styles/components/guided.css";

const route = useRoute(), router = useRouter();
const settings = useSettings();
const j = useJournal();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = typeof route.query.date === "string" && DATE.test(route.query.date) ? route.query.date : localYmd(new Date());
// the id goes into the address at once, so coming back after the lock (or a reload) takes up the same dream
const id = typeof route.query.id === "string" && route.query.id ? route.query.id : uuidv7();
// one opened without an id (the WBTB alarm's /capture?date=..&then=up) is new too: new=1 keeps a reload before the
// first word (offline: nothing on the server to look at) in the capture
if (route.query.id !== id) void router.replace({ query: { ...route.query, date, id, ...(route.query.id ? {} : { new: "1" }) } });
// a capture just opened for a new dream (captureFirst): nothing on the server can be written over, so a failed look
// there means nothing; the mark goes from the address as soon as there is something saved
const fresh = route.query.new === "1" || !route.query.id;
// after the WBTB alarm the capture hands on to the "I'm up" guide (and so does the editor it may go on to)
const afterUp = route.query.then === "up";
const carry = afterUp ? { then: "up" } : {};

const STILL_SECONDS = 20;
// the still moment is for waking: the morning, the night (from 22:00, as Start's "I woke up") and the night's alarm,
// not a dream written up in the afternoon or evening
const openedAt = new Date().getHours();
const wantStill = settings.value.capture.dim && (afterUp || openedAt < 14 || openedAt >= 22);
const step = ref<"still" | "words">(wantStill ? "still" : "words");
const words = ref<string[]>([]);
const typed = ref("");
const marks = reactive({ lucid: false, nightmare: false, feeling: false });
const cite = ref<string[] | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const ready = ref(false), busy = ref(false), err = ref("");
// when you woke from it (LDJ-177): stamped as a new capture opens in the night (wakings.ts), kept as it was when one
// is taken up again, so the night page and Insights can say when in the night your dreams come
const wokeAt = ref<string | null>(null);
let stillTimer: ReturnType<typeof setTimeout> | null = null;

const voiceOn = computed(() => !!settings.value.features.voiceNotes);
const text = () => [...words.value, typed.value.trim()].filter(Boolean).join(", ");
const empty = computed(() => !words.value.length && !typed.value.trim() && !marks.lucid && !marks.nightmare && !marks.feeling);
// a voice note (or any file) on the dream is content as much as words: a dream holding one is never removed from here.
// The list is shared with DreamMedia's (it reloads after an upload); leaving checks the server again (holdsMedia)
const media = useDreamMedia(() => id, () => ready.value);
const blank = computed(() => empty.value && !media.data.value?.length);
/** Whether the dream has files on the server; when that can't be known (offline), it may have. */
async function holdsMedia() {
  if (media.data.value?.length) return true;
  try { return (await api.get<MediaRow[]>("/media", { dreamId: id })).length > 0; } catch (e) { return !(e instanceof ApiError && e.status === 404); }
}
// "Just a feeling" is the lowest step of recall clarity ("Only a fragment"); Lucid takes the lowest lucid level, as
// in the editor; a nightmare clears a bad dream on the server (one or the other, C18)
const fields = (unfinished: boolean, t = text()) => ({
  text: t || null, lucid: marks.lucid, lucidityLevel: marks.lucid ? 1 : 0, nightmare: marks.nightmare,
  recallClarity: marks.feeling ? 1 : null, unfinished, ...(wokeAt.value ? { wokeAt: wokeAt.value } : {}),
});
// what the capture can show again without losing anything: key words and its three marks, nothing more (the
// capture saves every field each time, so taking up anything fuller here would write over it)
// (the editor's other fields, all empty; an unfinished one is still key words, a finished one was written out)
const OTHER = ["awareness", "vividness", "control", "emotionOverall", "badDream", "recurring", "falseAwakening", "sleepParalysis", "favourite", "dismissed", "becameLucidHow", "lucidTrigger", "durationEst", "lucidEnd", "planDone"];
function captureShaped(d: Record<string, unknown>) {
  return !d.title && !(typeof d.text === "string" && d.text.includes("\n")) && d.unfinished !== false
    && Number(d.lucidityLevel ?? 0) <= 1 && (d.recallClarity == null || d.recallClarity === 1)
    && OTHER.every((k) => d[k] == null || d[k] === false);
}
function takeUp(d: Record<string, unknown>) {
  wokeAt.value = typeof d.wokeAt === "string" ? d.wokeAt : null;
  words.value = typeof d.text === "string" ? d.text.split(/\s*[,\n]\s*/).filter(Boolean) : [];
  Object.assign(marks, { lucid: !!d.lucid, nightmare: !!d.nightmare, feeling: d.recallClarity === 1 });
  step.value = "words";
  // only a dream with something in it counts as made (an empty draft is just the capture having been open)
  started = !empty.value;
}
// fuller than a capture (or unreadable just now): the editor takes it, which never writes over it blind
function toEditor() { void router.replace({ name: "journal-write", params: { id }, query: { date, ...carry } }); }

// ----- the draft: the editor's own, so the lock, a reload or no connection never loses a word -----
let started = false;
// the dream is (or may be) on the server: leaving it empty, or No recall, takes it away again
let made = false;
// taken up from the server or from this device's storage: some of it may be on the server already, so emptied it is
// deleted there; one only ever made here (dropLocalDraft knows whether any of it was sent) just loses its draft
let earlier = false;
const nightsNow = async () => j.nights.data.value ?? (await api.get<NightRow[]>("/nights").catch(() => []));
async function open(): Promise<boolean> {
  const live = liveDraft(id), stored = live ? null : await openStored(id), draft = live ?? stored;
  if (draft) {
    // back after the lock: the words and marks as they were, and straight to the words
    const d = draft.dream as Record<string, unknown>;
    if (!captureShaped(d)) { toEditor(); return false; }
    takeUp(d);
    // a new one closed before its first word kept no time (a draft from before the time went into it): stamped now
    if (!wokeAt.value && !started && fresh) wokeAt.value = wakeStamp(new Date(), nightOfDate(await nightsNow(), date));
    made = started; earlier = true;
    if (!live) beginDraft(draft);
    if (stored && started) changeDream(id, fields(true));
  } else {
    // nothing kept here: the dream may be on the server already (key words sent, then a reload or Forward)
    let row: DreamFull | null = null;
    try { row = await api.get<DreamFull>(`/dreams/${id}`); }
    catch (e) { if (!(e instanceof ApiError && e.status === 404) && !fresh) { toEditor(); return false; } }
    if (row && (!captureShaped(row as unknown as Record<string, unknown>) || row.elements.length)) { toEditor(); return false; }
    const nights: NightRow[] = await nightsNow();
    const night = row ? nights.find((n) => n.id === row!.nightId) : null;
    if (row) { takeUp(row as unknown as Record<string, unknown>); made = earlier = true; }
    else wokeAt.value = wakeStamp(new Date(), nightOfDate(nights, date));
    // the draft starts with the time in it, so a capture closed in the still moment (the lock, switching away) and
    // opened again before the first word keeps when you woke; nothing is saved until the first change all the same
    const dream = !row && wokeAt.value ? { wokeAt: wokeAt.value } : {};
    beginDraft({ dreamId: id, nightId: row?.nightId ?? nightOfDate(nights, date)?.id ?? uuidv7(), date: night?.date ?? date, nap: night?.nap ?? false, dream, night: {}, link: [], unlink: [], newElements: [], savedAt: row?.updatedAt ? Date.parse(row.updatedAt) : 0 });
  }
  ready.value = true;
  return true;
}
// nothing is made until there is something to keep; from then on every change is saved (unfinished: key words only)
// Emptied again (every word taken off): nothing is saved, and leaving like that removes the dream (see leave)
function save() {
  if (!ready.value || empty.value) return;
  if (!started && fresh) void router.replace({ query: { ...route.query, new: undefined } });
  started = made = true;
  changeDream(id, fields(true));
}
watch([words, typed, marks], save, { deep: true });
// a voice note needs the dream on the server first: a recording about to go up saves what is here now (DreamMedia
// waits for it); playing, cancelling or a recording that fails leaves nothing made beyond that (see leave)
function beforeUpload() { if (!ready.value) return; started = made = true; changeDream(id, fields(true)); }
/** Takes away the dream made here and emptied again: just the draft when none of it left this device. */
async function unmake() {
  started = false;
  if (!earlier && dropLocalDraft(id)) { made = false; return; }
  await deleteDream(id); made = false;
}

// ----- the still moment -----
function toWords() {
  if (stillTimer) { clearTimeout(stillTimer); stillTimer = null; }
  step.value = "words";
  void nextTick(() => inputEl.value?.focus());
}

// ----- key words: a comma or Enter makes a chip -----
function commit(all = true) {
  const parts = typed.value.split(",");
  // while typing, the part after the last comma is still being written
  const rest = all ? "" : parts.pop() ?? "";
  for (const p of parts) { const w = p.trim(); if (w && !words.value.includes(w)) words.value.push(w); }
  typed.value = rest;
}
function onInput() { if (typed.value.includes(",")) commit(false); }
function onKey(e: KeyboardEvent) {
  if (e.key === "Enter") { e.preventDefault(); commit(); }
  else if (e.key === "Backspace" && !typed.value && words.value.length) words.value.pop();
}
const dropWord = (i: number) => { words.value.splice(i, 1); };
function toggle(k: "lucid" | "nightmare" | "feeling") { marks[k] = !marks[k]; }

// ----- leaving -----
const state = computed(() => saveState[id]);
const stateText = computed(() => ({ saving: "Saving", saved: "Saved", waiting: "Kept on this device", error: saveError[id] ?? "Couldn't save" } as Record<string, string>)[state.value ?? ""] ?? "");
function go() { if (afterUp) void router.replace("/train/guided/up"); else goBack(router, "/"); }
async function leave() {
  if (empty.value && !(made && (await holdsMedia()))) {
    // nothing entered: nothing is kept, and a dream already made from words since taken off goes again (if that
    // fails, offline, the last words saved stay: better than an empty dream). One holding a voice note stays.
    if (made) await unmake().catch(() => undefined); else { started = false; endDraft(id); }
  } else { saveNow(id); endDraft(id); }
  go();
}
/** On to the editor: the key words at the top of the text, the cursor under them. */
function writeOut() {
  commit();
  const t = text();
  if (!empty.value) { started = made = true; changeDream(id, fields(false, t ? `${t}\n\n` : "")); saveNow(id); }
  toEditor();
}
/** Later: the key words are the dream for now, marked unfinished (the editor shows it, and writing on finishes it). */
function later() { commit(); save(); void leave(); }
// No recall is for a night with no dreams: not offered when the night has another one (markNoRecall refuses it too)
const otherDreams = computed(() => (j.facts.data.value ?? []).some((x) => x.date === date && !x.nap && x.id !== id));
async function noRecall() {
  if (busy.value) return;
  busy.value = true; err.value = "";
  try {
    // a dream made here before the words were taken off goes first, or it would be a night with a dream and no recall
    // (never one holding a voice note: that is a dream remembered)
    if (made && (await holdsMedia())) throw new Error("This dream has a voice note. Remove it first, or keep the dream.");
    if (made) await unmake(); else endDraft(id);
    await markNoRecall(date);
    go();
  } catch (e) {
    // still here: the words typed next need a draft to go into again
    if (!liveDraft(id)) beginDraft({ dreamId: id, nightId: nightOfDate(j.nights.data.value ?? [], date)?.id ?? uuidv7(), date, nap: false, dream: {}, night: {}, link: [], unlink: [], newElements: [], savedAt: 0 });
    err.value = e instanceof Error && e.message ? e.message : "It couldn't be saved";
  }
  finally { busy.value = false; }
}

onMounted(async () => {
  if (!(await open())) return;
  if (step.value === "still") stillTimer = setTimeout(toWords, STILL_SECONDS * 1000);
  else void nextTick(() => inputEl.value?.focus());
});
onBeforeUnmount(() => { if (stillTimer) clearTimeout(stillTimer); if (started) saveNow(id); });
</script>

<template>
  <div v-trap class="gd cap" role="dialog" aria-modal="true" aria-label="Capture your dream">
    <div class="gtop">
      <button type="button" class="gx" @click="leave"><Icon name="close" :size="18" /> Close</button>
      <span class="grow" />
      <span class="gname" aria-live="polite">{{ stateText || (wokeAt ? `Woke at ${clockOf(wokeAt)}` : "Morning") }}</span>
    </div>

    <div v-if="step === 'still'" class="gbody capstill">
      <div class="capring" aria-hidden="true">
        <svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="54" /><circle class="fg" cx="60" cy="60" r="54" :style="{ animationDuration: STILL_SECONDS + 's' }" /></svg>
      </div>
      <h1>Stay still. What were you just dreaming?</h1>
      <p class="gp">Then what happened before that?</p>
      <Ev text="Don't move or think about the day yet: moving can make the dream harder to get back. Rebuild it backwards, scene by scene. If nothing comes, ask how you were just feeling [C1]." @cite="cite = $event" />
      <span class="grow" />
      <button type="button" class="btn lg block" @click="toWords">I've got something</button>
      <button type="button" class="glink" @click="toWords">Skip</button>
    </div>

    <div v-else class="gbody">
      <h1>A few key words</h1>
      <Ev text="Write a few key words now and the rest later [C1][C2]. Keeping a journal helps you remember more dreams [C30][B48]." @cite="cite = $event" />
      <input ref="inputEl" v-model="typed" class="gintent capin" type="text" enterkeyhint="enter" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="400"
        placeholder="People, places, feelings..." aria-label="Key words, separated by commas" @input="onInput" @keydown="onKey" @blur="commit()" />
      <div v-if="words.length" class="capwords" aria-label="Key words">
        <span v-for="(w, i) in words" :key="w + i" class="capword">{{ w }}<button type="button" :aria-label="`Remove ${w}`" @click="dropWord(i)"><Icon name="close" :size="14" /></button></span>
      </div>
      <div class="gchips capmarks">
        <button type="button" class="gchip" :class="{ on: marks.lucid }" :aria-pressed="marks.lucid" @click="toggle('lucid')"><b>Lucid</b></button>
        <button type="button" class="gchip" :class="{ on: marks.nightmare }" :aria-pressed="marks.nightmare" @click="toggle('nightmare')"><b>Nightmare</b></button>
        <button type="button" class="gchip" :class="{ on: marks.feeling }" :aria-pressed="marks.feeling" @click="toggle('feeling')"><b>Just a feeling</b></button>
        <button v-if="blank && !otherDreams" type="button" class="gchip" :disabled="busy" @click="noRecall"><b>No recall</b></button>
      </div>
      <p v-if="err" class="gev" role="alert">{{ err }}</p>
      <div v-if="voiceOn && ready" class="gbox"><DreamMedia :dream-id="id" edit voice @upload="beforeUpload" /></div>
      <span class="grow" />
      <button type="button" class="btn lg block" @click="writeOut">Write it out</button>
      <button type="button" class="glink" @click="later">{{ blank ? "Not now" : "Later" }}</button>
    </div>

    <SourceSheet v-if="cite" :ids="cite" @close="cite = null" />
  </div>
</template>

<style scoped>
/* on the night surface of the guided screens (guided.css: --sdim tokens, the accent mixed down); spacing from the
   density tokens */
.capstill { text-align: center; align-items: center; }
.capstill .btn, .capstill .glink { align-self: stretch; }
.capring { width: 132px; height: 132px; margin: var(--spg) auto var(--hg); }
.capring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.capring circle { fill: none; stroke-width: 3; }
.capring .bg { stroke: var(--sdim2); }
.capring .fg { stroke: var(--gacc); stroke-linecap: round; stroke-dasharray: 339.3; stroke-dashoffset: 339.3; animation: capfill linear forwards; opacity: .7; }
@keyframes capfill { to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) { .capring .fg { animation: none; stroke-dashoffset: 0; opacity: .35; } }
.capin { font-size: calc(var(--fs-lg) + 4px); min-height: 56px; }
.capwords { display: flex; flex-wrap: wrap; gap: var(--tdy); }
.capword { display: inline-flex; align-items: center; gap: calc(var(--tdy) / 2); background: var(--sdim2); color: var(--sdimtx); border-radius: var(--pill); padding: var(--tdy) var(--tdy) var(--tdy) var(--lpy); font-size: var(--fs-lg); }
.capword button { background: none; border: 0; color: var(--sdimtx2); padding: calc(var(--tdy) / 2); cursor: pointer; display: inline-flex; border-radius: var(--pill); }
.capmarks .gchip { min-height: 56px; justify-content: center; }
.capmarks .gchip b { font-size: var(--fs-lg); }
.cap .btn.lg { min-height: 56px; }
.cap :deep(.jrec) { background: var(--sdim); color: var(--sdimtx); }
.cap :deep(.jmut) { color: var(--sdimtx2); }
</style>
