<script setup lang="ts">
// A dream's photos, sketches and voice notes (PLAN.md §6.2, LDJ-20). Each kind is an optional feature: off, its button
// and its files are absent. Every file is sealed on this device before it goes up (api/client.ts) and opened here into
// an object URL that the lock lets go of (api/media.ts). Photos lose their EXIF on the way (core/image.ts).
// edit: the editor's version (add, read the text, delete); without it, the dream page's thumbnails and players.
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { mediaFeatures, VOICE_MAX_SECONDS } from "@somnium/shared";
import { ApiError } from "../../api/client";
import { addMedia, mediaBlob, mediaObjectUrl, removeMedia, saveOcrText, useDreamMedia, type MediaRow } from "../../api/media";
import { saveNow } from "../../api/journal";
import { useSettings } from "../../api/queries";
import { confirm } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import Icon from "../Icon.vue";
import Sheet from "../Sheet.vue";
import SketchPad from "./SketchPad.vue";

const props = defineProps<{ dreamId: string; edit?: boolean }>();
const emit = defineEmits<{ text: [string] }>();
const settings = useSettings();
const on = computed(() => mediaFeatures(settings.value.features));
const list = useDreamMedia(() => props.dreamId, () => on.value.any);
const shows = (m: MediaRow) => (m.kind === "photo" && on.value.photos) || (m.kind === "sketch" && on.value.sketches) || (m.kind === "audio" && on.value.voice);
const items = computed(() => (list.data.value ?? []).filter(shows));
const pictures = computed(() => items.value.filter((m) => m.kind !== "audio"));
const voices = computed(() => items.value.filter((m) => m.kind === "audio"));

// object URLs of the opened files, as they come
const src = reactive<Record<string, string>>({});
watch(items, (ms) => { for (const m of ms) if (!src[m.id]) mediaObjectUrl(m.id).then((u) => (src[m.id] = u)).catch(() => {}); }, { immediate: true });

const busy = ref("");
/** Up it goes; a dream written a moment ago may not have reached the server yet, so a few short waits for it. */
async function upload(file: Blob, extra?: { kind?: "sketch"; duration?: number }) {
  saveNow(props.dreamId);
  for (let i = 0; ; i++) {
    try { return await addMedia(props.dreamId, file, extra); }
    catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
      if (i >= 4) throw new Error("The dream hasn't reached the server yet. Try again in a moment.");
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}
/** failed: an upload's own headline. Every way an upload can go wrong says so (LDJ-68: one once failed without a word),
 *  with the reason the app or server gave, never anything from the file or the dream. */
async function run(what: string, f: () => Promise<unknown>, failed?: string) {
  if (busy.value) { if (failed) toast(`${failed}: wait for the one being saved, then try again.`, { kind: "err" }); return; }
  busy.value = what;
  try { await f(); }
  catch (e) { if (failed) toast(`${failed}. ${e instanceof Error && e.message ? e.message : "Try again."}`, { kind: "err" }); else toastError(e); }
  finally { busy.value = ""; }
}

// ----- photos -----
const photoIn = ref<HTMLInputElement | null>(null);
async function onPhoto(ev: Event) {
  const input = ev.target as HTMLInputElement, files = [...(input.files ?? [])]; input.value = "";
  await run("Adding the photo", async () => {
    const { cleanPhoto } = await import("../../core/image");
    for (const f of files) await upload(await cleanPhoto(f));
  }, files.length > 1 ? "Not all the photos were added" : "The photo wasn't added");
}

// ----- reading the text of a photo (OCR) -----
let reader: typeof import("../../core/ocr") | null = null; // loaded on the first "Read the text", never before
const ocr = ref<{ m: MediaRow; step: string; progress: number; text: string; done: boolean; error: string } | null>(null);
async function readPhoto(m: MediaRow) {
  ocr.value = { m, step: "Loading the reader", progress: 0, text: m.ocrText ?? "", done: !!m.ocrText, error: "" };
  if (m.ocrText) return; // read before: the checked text is kept on the photo
  const o = ocr.value;
  try {
    const blob = await mediaBlob(m.id);
    reader = await import("../../core/ocr");
    const text = await reader.readText(blob, (p) => { o.step = p.step; o.progress = p.progress; });
    if (ocr.value !== o) return;
    o.text = text; o.done = true;
    if (!text) o.error = "No text found in this photo.";
  } catch (e) { if (ocr.value === o) o.error = e instanceof Error ? e.message : "This photo couldn't be read"; }
}
const useOcr = () => run("Saving", async () => {
  const o = ocr.value; if (!o) return;
  const text = o.text.trim();
  if (text) { emit("text", text); await saveOcrText(o.m, text); }
  ocr.value = null;
});

// ----- sketches -----
const sketching = ref(false);
const saveSketch = (b: Blob) => run("Saving the sketch", async () => { await upload(b, { kind: "sketch" }); sketching.value = false; }, "The sketch wasn't saved");

// ----- voice notes -----
// MediaRecorder, Opus in WebM where the browser has it (Safari records MP4/AAC). Nothing transcribes it.
const rec = ref<{ r: MediaRecorder; stream: MediaStream; started: number; secs: number } | null>(null);
let tick: ReturnType<typeof setInterval> | undefined;
const pickType = () => ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
const canRecord = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
async function record() {
  if (rec.value || busy.value) return;
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { toastError(new Error("The microphone isn't available")); return; }
  const type = pickType();
  const r = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
  const parts: Blob[] = [];
  const started = Date.now();
  r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  r.onstop = () => {
    clearInterval(tick);
    stream.getTracks().forEach((t) => t.stop());
    const secs = Math.min(VOICE_MAX_SECONDS, Math.round((Date.now() - started) / 1000));
    const keep = rec.value?.r === r && !dropping;
    rec.value = null; dropping = false;
    if (!keep || !parts.length) return;
    const blob = new Blob(parts, { type: (r.mimeType || type || "audio/webm").split(";")[0] });
    void run("Saving the voice note", () => upload(blob, { duration: secs }), "The voice note wasn't saved");
  };
  r.start(1000);
  rec.value = { r, stream, started, secs: 0 };
  tick = setInterval(() => {
    if (!rec.value) return;
    rec.value.secs = Math.floor((Date.now() - started) / 1000);
    if (rec.value.secs >= VOICE_MAX_SECONDS) stop(); // the cap: it stops and is kept
  }, 250);
}
let dropping = false;
function stop() { if (rec.value?.r.state !== "inactive") rec.value?.r.stop(); }
function drop() { dropping = true; stop(); }
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ----- viewing and removing -----
const viewing = ref<MediaRow | null>(null);
async function remove(m: MediaRow) {
  const what = m.kind === "audio" ? "voice note" : m.kind;
  if (!(await confirm(`Delete this ${what}?`, { ok: "Delete", danger: true }))) return;
  await run("Deleting", async () => { await removeMedia(m); delete src[m.id]; if (viewing.value?.id === m.id) viewing.value = null; });
}

onBeforeUnmount(() => {
  drop();
  clearInterval(tick);
  // the reader holds the page's text in its memory: it goes with the screen (it loads again from the cache next time)
  if (reader) void reader.stopOcr();
});
</script>

<template>
  <div v-if="on.any && (edit || items.length)" class="jmed">
    <div v-if="edit" class="jmadd">
      <button v-if="on.photos" class="qb" :disabled="!!busy" @click="photoIn?.click()"><Icon name="camera" :size="16" />Photo</button>
      <input v-if="on.photos" ref="photoIn" type="file" accept="image/*" multiple hidden @change="onPhoto" />
      <button v-if="on.sketches" class="qb" :disabled="!!busy" @click="sketching = true"><Icon name="edit" :size="16" />Sketch</button>
      <button v-if="on.voice && canRecord && !rec" class="qb" :disabled="!!busy" @click="record"><Icon name="sound" :size="16" />Voice note</button>
      <span v-if="busy" class="tiny jmut" aria-live="polite">{{ busy }}...</span>
    </div>
    <div v-if="rec" class="card jrec" role="group" aria-label="Recording">
      <span class="jdot" aria-hidden="true" />
      <div class="grow">Recording {{ clock(rec.secs) }} <span class="tiny jmut">· stops at {{ clock(VOICE_MAX_SECONDS) }}</span></div>
      <button class="qb" @click="drop">Cancel</button>
      <button class="btn s" @click="stop">Stop</button>
    </div>

    <div v-if="pictures.length" class="jthumbs">
      <div v-for="m in pictures" :key="m.id" class="jth">
        <button class="jthb" :aria-label="m.kind === 'sketch' ? 'Open sketch' : 'Open photo'" @click="viewing = m">
          <img v-if="src[m.id]" :src="src[m.id]" alt="" />
          <Icon v-else name="image" :size="20" />
        </button>
        <div v-if="edit" class="jthact">
          <button v-if="m.kind === 'photo'" class="qb sm" :aria-label="'Read the text'" @click="readPhoto(m)">{{ m.ocrText ? "Text" : "Read the text" }}</button>
          <button class="jx" aria-label="Delete" @click="remove(m)"><Icon name="trash" :size="14" /></button>
        </div>
      </div>
    </div>
    <div v-for="m in voices" :key="m.id" class="jvoice">
      <audio v-if="src[m.id]" controls preload="metadata" :src="src[m.id]" />
      <span v-else class="tiny jmut">Opening the voice note...</span>
      <span v-if="m.duration" class="tiny jmut">{{ clock(m.duration) }}</span>
      <button v-if="edit" class="jx" aria-label="Delete voice note" @click="remove(m)"><Icon name="trash" :size="14" /></button>
    </div>

    <Sheet v-if="ocr" title="Text in the photo" @close="ocr = null">
      <div v-if="!ocr.done && !ocr.error" class="jocrp" aria-live="polite">
        <div class="tiny">{{ ocr.step }}{{ ocr.progress ? " · " + Math.round(ocr.progress * 100) + "%" : "" }}</div>
        <div class="jbar2"><div :style="{ width: Math.round(ocr.progress * 100) + '%' }" /></div>
        <p class="tiny jmut">Read on this device. The first time, the reader and its English model are loaded from your server.</p>
      </div>
      <p v-if="ocr.error" class="tiny jerr">{{ ocr.error }}</p>
      <template v-if="ocr.done">
        <p class="tiny jmut">Check the text and fix what was misread. It is added to the end of the dream.</p>
        <textarea v-model="ocr.text" class="jocrt" aria-label="Text read from the photo" />
      </template>
      <div class="jocrf">
        <button class="btn o" @click="ocr = null">Cancel</button>
        <button class="btn" :disabled="!ocr.done || !ocr.text.trim() || !!busy" @click="useOcr">Use this text</button>
      </div>
    </Sheet>

    <Sheet v-if="viewing" :title="viewing.kind === 'sketch' ? 'Sketch' : 'Photo'" size="wide" @close="viewing = null">
      <img v-if="src[viewing.id]" :src="src[viewing.id]" class="jfullimg" alt="" />
      <div v-if="edit" class="jocrf"><button class="btn o" @click="remove(viewing)"><Icon name="trash" :size="14" />Delete</button></div>
    </Sheet>

    <SketchPad v-if="sketching" @save="saveSketch" @close="sketching = false" />
  </div>
</template>

<style scoped>
.jmed { display: flex; flex-direction: column; gap: var(--hg); min-width: 0; }
.jmadd { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
.jmadd .qb { padding-left: 0; }
.jmut { color: var(--tx2); }
.jerr { color: var(--neg); }
.jthumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.jth { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.jthb { aspect-ratio: 1; width: 100%; padding: 0; border: 1px solid var(--ol); border-radius: var(--r); background: var(--s2); color: var(--tx2); overflow: hidden; display: grid; place-items: center; cursor: pointer; }
.jthb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.jthact { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.jthact .qb { padding: 0; font-size: 12px; min-width: 0; }
.jx { border: 0; background: none; color: var(--tx2); padding: 2px; display: inline-grid; place-items: center; cursor: pointer; }
.jx:hover, .jx:focus-visible { color: var(--neg); }
.jvoice { display: flex; align-items: center; gap: 8px; min-width: 0; }
.jvoice audio { flex: 1; min-width: 0; max-width: 100%; }
.jrec { display: flex; align-items: center; gap: 8px; }
.jdot { width: 10px; height: 10px; border-radius: 50%; background: var(--neg); animation: jpulse 1.2s ease-in-out infinite; }
@keyframes jpulse { 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { .jdot { animation: none; } }
.jocrp { display: flex; flex-direction: column; gap: 8px; }
.jbar2 { height: 6px; border-radius: var(--pill); background: var(--s2); overflow: hidden; }
.jbar2 div { height: 100%; background: var(--acc); transition: width 0.2s; }
.jocrt { width: 100%; min-height: 220px; resize: vertical; font-size: 15px; line-height: 1.5; }
.jocrf { display: flex; justify-content: flex-end; gap: 8px; margin-top: var(--hg); }
.jfullimg { display: block; max-width: 100%; max-height: 75vh; margin: 0 auto; border-radius: var(--r); }
</style>
