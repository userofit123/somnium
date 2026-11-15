<script setup lang="ts">
// The morning capture (LDJ-80): what the morning reminder, the WBTB alarm, Home's "Write last night's dream" and the
// phone's + open. Half asleep, the dream fades in the first minute, so: first a still moment on the dim night
// surface (lie still, ask what you were dreaming, rebuild it backwards), then key words, each one a chip, and the
// marks that take one tap. "Write it out" goes on to the editor with the words at the top; "Later" keeps them as the
// dream and marks it unfinished (RESEARCH.md C1, C2). It saves as you type through the editor's own draft (sealed
// on this device, sent or kept for later, api/journal.ts), and App.vue draws it only behind the lock.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { nightOfDate } from "@somnium/shared";
import { api } from "../../api/client";
import { beginDraft, changeDream, endDraft, liveDraft, markNoRecall, openStored, saveError, saveNow, saveState, useJournal, uuidv7, type NightRow } from "../../api/journal";
import { useSettings } from "../../api/queries";
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
if (route.query.id !== id) void router.replace({ query: { ...route.query, date, id } });
// after the WBTB alarm the capture hands on to the "I'm up" guide
const afterUp = route.query.then === "up";

const STILL_SECONDS = 20;
// the still moment is for waking: the morning and the night's alarm, not a dream written up in the afternoon
const wantStill = settings.value.capture.dim && (afterUp || new Date().getHours() < 14);
const step = ref<"still" | "words">(wantStill ? "still" : "words");
const words = ref<string[]>([]);
const typed = ref("");
const marks = reactive({ lucid: false, nightmare: false, feeling: false });
const cite = ref<string[] | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const ready = ref(false), busy = ref(false), err = ref("");
let stillTimer: ReturnType<typeof setTimeout> | null = null;

const voiceOn = computed(() => !!settings.value.features.voiceNotes);
const text = () => [...words.value, typed.value.trim()].filter(Boolean).join(", ");
const empty = computed(() => !words.value.length && !typed.value.trim() && !marks.lucid && !marks.nightmare && !marks.feeling);
// "Just a feeling" is the lowest step of recall clarity ("Only a fragment"); Lucid takes the lowest lucid level, as
// in the editor; a nightmare clears a bad dream on the server (one or the other, C18)
const fields = (unfinished: boolean, t = text()) => ({
  text: t || null, lucid: marks.lucid, lucidityLevel: marks.lucid ? 1 : 0, nightmare: marks.nightmare,
  recallClarity: marks.feeling ? 1 : null, unfinished,
});

// ----- the draft: the editor's own, so the lock, a reload or no connection never loses a word -----
let started = false;
async function open() {
  const live = liveDraft(id), stored = live ? null : await openStored(id), draft = live ?? stored;
  if (draft) {
    // back after the lock: the words and marks as they were, and straight to the words
    const d = draft.dream as Record<string, unknown>;
    words.value = typeof d.text === "string" ? d.text.split(/\s*[,\n]\s*/).filter(Boolean) : [];
    Object.assign(marks, { lucid: !!d.lucid, nightmare: !!d.nightmare, feeling: d.recallClarity === 1 });
    step.value = "words";
    started = true;
    if (!live) beginDraft(draft);
    if (stored) changeDream(id, fields(true));
  } else {
    const nights: NightRow[] = j.nights.data.value ?? (await api.get<NightRow[]>("/nights").catch(() => []));
    beginDraft({ dreamId: id, nightId: nightOfDate(nights, date)?.id ?? uuidv7(), date, nap: false, dream: {}, night: {}, link: [], unlink: [], newElements: [], savedAt: 0 });
  }
  ready.value = true;
}
// nothing is made until there is something to keep; from then on every change is saved (unfinished: key words only)
function save() {
  if (!ready.value || (empty.value && !started)) return;
  started = true;
  changeDream(id, fields(true));
}
watch([words, typed, marks], save, { deep: true });
// a voice note needs the dream on the server first: tapping it saves what is here now (DreamMedia waits for it)
function beforeVoice() { if (!ready.value) return; started = true; changeDream(id, fields(true)); }

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
function leave() {
  saveNow(id); endDraft(id);
  if (afterUp) void router.replace("/train/guided/up"); else goBack(router, "/");
}
/** On to the editor: the key words at the top of the text, the cursor under them. */
function writeOut() {
  commit();
  const t = text();
  if (started || !empty.value) { started = true; changeDream(id, fields(false, t ? `${t}\n\n` : "")); saveNow(id); }
  void router.replace({ name: "journal-write", params: { id }, query: { date } });
}
/** Later: the key words are the dream for now, marked unfinished (the editor shows it, and writing on finishes it). */
function later() { commit(); save(); leave(); }
async function noRecall() {
  if (busy.value) return;
  busy.value = true; err.value = "";
  try { await markNoRecall(date); endDraft(id); leave(); }
  catch (e) { err.value = e instanceof Error && e.message ? e.message : "It couldn't be saved"; }
  finally { busy.value = false; }
}

onMounted(async () => {
  await open();
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
      <span class="gname" aria-live="polite">{{ stateText || "Morning" }}</span>
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
        <button v-if="empty" type="button" class="gchip" :disabled="busy" @click="noRecall"><b>No recall</b></button>
      </div>
      <p v-if="err" class="gev" role="alert">{{ err }}</p>
      <div v-if="voiceOn && ready" class="gbox" @click.capture="beforeVoice"><DreamMedia :dream-id="id" edit voice /></div>
      <span class="grow" />
      <button type="button" class="btn lg block" @click="writeOut">Write it out</button>
      <button type="button" class="glink" @click="later">{{ empty ? "Not now" : "Later" }}</button>
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
.capin { font-size: 20px; min-height: 56px; }
.capwords { display: flex; flex-wrap: wrap; gap: var(--tdy); }
.capword { display: inline-flex; align-items: center; gap: calc(var(--tdy) / 2); background: var(--sdim2); color: var(--sdimtx); border-radius: var(--pill); padding: var(--tdy) var(--tdy) var(--tdy) var(--lpy); font-size: var(--fs-lg); }
.capword button { background: none; border: 0; color: var(--sdimtx2); padding: calc(var(--tdy) / 2); cursor: pointer; display: inline-flex; border-radius: var(--pill); }
.capmarks .gchip { min-height: 56px; justify-content: center; }
.capmarks .gchip b { font-size: var(--fs-lg); }
.cap .btn.lg { min-height: 56px; }
.cap :deep(.jrec) { background: var(--sdim); color: var(--sdimtx); }
.cap :deep(.jmut) { color: var(--sdimtx2); }
</style>
