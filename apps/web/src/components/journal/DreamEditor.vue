<script setup lang="ts">
// Writing a dream (PLAN.md §6.2): full screen on the phone, opening with the keyboard; a side panel on a computer.
// Every change is saved as it is made (api/journal.ts says where a draft waits), so the lock, a reload or a lost
// connection never costs a word. Saving is quiet: a word in the corner, never a toast.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { addAlias, elementMatches, fold, mergeDraft, parseDismissed, mergeLinks, nightOfDate, ELEMENT_KIND_LABEL, NEW_ELEMENT_KINDS, CONTROL_ANCHORS, EMOTION_ANCHORS, LUCIDITY_ANCHORS, RECALL_ANCHORS, VIVIDNESS_ANCHORS, type Element, type Suggestion } from "@somnium/shared";
import { api, ApiError } from "../../api/client";
import { beginDraft, changeDream, deleteDream, endDraft, linkElement, teachAlias, liveDraft, openStored, saveError, saveNow, saveState, unlinkElement, useJournal, uuidv7, type DreamFull, type NightRow } from "../../api/journal";
import { localYmd, useFmt } from "../../core/format";
import { confirm } from "../../core/ask";
import { toastError } from "../../core/toast";
import Icon from "../Icon.vue";
import Menu from "../Menu.vue";
import Collapse from "../Collapse.vue";
import NightSheet from "./NightSheet.vue";
import { loadLexicons, suggestElements } from "./detect";

// fresh: a dream started here just now (a new id), so not reaching the server can't mean writing over one there
const props = defineProps<{ id: string; date?: string; full?: boolean; fresh?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const j = useJournal();
const fmt = useFmt();

const FIELDS = ["title", "text", "lucid", "lucidityLevel", "vividness", "control", "recallClarity", "emotionOverall", "nightmare", "recurring", "falseAwakening", "sleepParalysis", "favourite", "dismissed"] as const;
const f = reactive<Record<string, any>>({ title: "", text: "", lucid: false, lucidityLevel: 0, vividness: null, control: null, recallClarity: null, emotionOverall: null, nightmare: false, recurring: false, falseAwakening: false, sleepParalysis: false, favourite: false, dismissed: null });
const where = reactive({ date: props.date ?? localYmd(new Date()), nap: false, nightId: "" });
const chosen = ref<string[]>([]);
const made = ref<Pick<Element, "id" | "name" | "kind" | "aliases">[]>([]);
const ready = ref(false), loadError = ref(""), more = ref(false), nightOpen = ref(false), existed = ref(false);
const textEl = ref<HTMLTextAreaElement | null>(null);

async function load() {
  let row: DreamFull | null = null;
  try { row = await api.get<DreamFull>(`/dreams/${props.id}`); }
  catch (e) { if (!(e instanceof ApiError && e.status === 404) && !props.fresh) loadError.value = e instanceof Error ? e.message : "Couldn't open this dream"; }
  const live = liveDraft(props.id), stored = live ? null : await openStored(props.id), draft = live ?? stored;
  // can't read the dream as it is now and nothing kept here: writing over it blind could undo it
  if (loadError.value && !draft) return;
  loadError.value = "";
  existed.value = !!row;
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
  await nextTick();
  ready.value = true;
  // a draft kept here that the server hasn't got yet goes now
  if (stored || (live && saveState[props.id] && saveState[props.id] !== "saved")) changeDream(props.id, pick());
}
const pick = () => Object.fromEntries(FIELDS.map((k) => [k, f[k]]));

watch(f, () => { if (ready.value) changeDream(props.id, pick()); }, { deep: true });
// a level of lucidity means it was lucid; not lucid means level 0
watch(() => f.lucidityLevel, (v) => { if (v > 0 && !f.lucid) f.lucid = true; });
watch(() => f.lucid, (v) => { if (!v && f.lucidityLevel) f.lucidityLevel = 0; });

const vivid = computed(() => (f.vividness ?? 0) >= 4);
const CHIPS = [
  { k: "lucid", label: "Lucid" }, { k: "vivid", label: "Vivid" }, { k: "nightmare", label: "Nightmare" }, { k: "recurring", label: "Recurring" },
  { k: "falseAwakening", label: "False awakening" }, { k: "sleepParalysis", label: "Sleep paralysis" },
];
const chipOn = (k: string) => (k === "vivid" ? vivid.value : !!f[k]);
function toggleChip(k: string) {
  if (k === "vivid") f.vividness = vivid.value ? null : 4;
  else f[k] = !f[k];
}
const set = (k: string, v: number) => { f[k] = f[k] === v ? (k === "lucidityLevel" ? 0 : null) : v; };

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
function createEl() {
  const name = typed.value.trim();
  if (!name) return;
  const id = uuidv7(), kind = newKind.value;
  made.value.push({ id, name, kind, aliases: null });
  chosen.value.push(id);
  linkElement(props.id, id, { name, kind });
  typed.value = "";
}
const onCreate = computed(() => !exact.value && hi.value === matches.value.length);
function stepKind(by: number) { const i = NEW_ELEMENT_KINDS.indexOf(newKind.value); newKind.value = NEW_ELEMENT_KINDS[(i + by + NEW_ELEMENT_KINDS.length) % NEW_ELEMENT_KINDS.length]!; }
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
  made.value.push({ id, name: s.name, kind: s.kind, aliases });
  chosen.value.push(id);
  linkElement(props.id, id, { name: s.name, kind: s.kind, aliases, ...(s.type === "sign" ? { isDreamSign: true, signCategory: s.signCategory ?? null } : {}) }, meta);
}
/** Not this one, for this dream: kept with the dream (sealed), so it stays gone after a reload and on other devices. */
function dismissSug(s: Suggestion) { f.dismissed = JSON.stringify([...dismissedKeys.value, s.key]); }

const state = computed(() => saveState[props.id]);
const stateText = computed(() => ({ saving: "Saving", saved: "Saved", waiting: "Kept on this device · sends when the server is back", error: saveError[props.id] ?? "Couldn't save" } as Record<string, string>)[state.value ?? ""] ?? "");

function done() { saveNow(props.id); endDraft(props.id); emit("close"); }
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
  setTimeout(() => void loadLexicons(), 0);
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
    <div class="jbar">
      <button class="ib sm plain" aria-label="Close" @click="done"><Icon :name="full ? 'left' : 'close'" :size="18" /></button>
      <div class="grow jst tiny" :class="{ err: state === 'error' }" aria-live="polite">{{ stateText }}</div>
      <Menu :items="menu" />
      <button class="btn" @click="done">Done</button>
    </div>
    <div v-if="loadError" class="card empty sm">{{ loadError }}</div>
    <template v-else-if="ready">
      <button class="qb jnight" @click="nightOpen = true"><Icon name="moon" :size="16" />{{ fmt.date(where.date, { weekday: "long", day: "numeric", month: "long" }) }}{{ where.nap ? " · Nap" : "" }}</button>
      <input v-model="f.title" class="jtitle" placeholder="Title" maxlength="200" />
      <textarea ref="textEl" v-model="f.text" class="jtext" placeholder="I am standing in a house I don't know. The light is strange..." />
      <div v-if="suggested.length" class="jfound" aria-label="Found in the text">
        <span v-for="s in suggested" :key="s.key" class="jsg">
          <button class="jsgo" :aria-label="'Add ' + s.name" @click="confirmSug(s)"><Icon name="plus" :size="12" />{{ s.name }}<span class="jkind">{{ ELEMENT_KIND_LABEL[s.kind] }}</span></button>
          <button class="jx" :aria-label="'Not ' + s.name" @click="dismissSug(s)"><Icon name="close" :size="12" /></button>
        </span>
      </div>

      <div class="chips jchips">
        <button v-for="c in CHIPS" :key="c.k" class="fchip" :class="{ on: chipOn(c.k) }" :aria-pressed="chipOn(c.k)" @click="toggleChip(c.k)">{{ c.label }}</button>
      </div>

      <div class="fld">
        <label>Lucidity</label>
        <div class="seg jscale"><button v-for="n in 6" :key="n" :class="{ on: f.lucidityLevel === n - 1 }" @click="set('lucidityLevel', n - 1)">{{ n - 1 }}</button></div>
        <div class="tiny jan">{{ LUCIDITY_ANCHORS[f.lucidityLevel ?? 0] }}</div>
      </div>
      <div class="fld">
        <label>Vividness</label>
        <div class="seg jscale"><button v-for="n in 5" :key="n" :class="{ on: f.vividness === n }" @click="set('vividness', n)">{{ n }}</button></div>
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
                  <button v-for="k in NEW_ELEMENT_KINDS" :key="k" class="fchip" :class="{ on: newKind === k }" role="radio" :aria-checked="newKind === k" @mousedown.prevent="newKind = k">{{ ELEMENT_KIND_LABEL[k] }}</button>
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
          <div class="seg jscale"><button v-for="n in 6" :key="n" :class="{ on: f.control === n - 1 }" @click="set('control', n - 1)">{{ n - 1 }}</button></div>
          <div class="tiny jan">{{ f.control != null ? CONTROL_ANCHORS[f.control] : "Not set" }}</div>
        </div>
        <div class="fld">
          <label>Recall clarity</label>
          <div class="seg jscale"><button v-for="n in 5" :key="n" :class="{ on: f.recallClarity === n }" @click="set('recallClarity', n)">{{ n }}</button></div>
          <div class="tiny jan">{{ f.recallClarity ? RECALL_ANCHORS[f.recallClarity - 1] : "Not set" }}</div>
        </div>
        <div class="fld">
          <label>Overall emotion</label>
          <div class="seg jscale"><button v-for="n in 5" :key="n" :class="{ on: f.emotionOverall === n - 3 }" @click="set('emotionOverall', n - 3)">{{ n - 3 > 0 ? "+" + (n - 3) : n - 3 }}</button></div>
          <div class="tiny jan">{{ f.emotionOverall != null ? EMOTION_ANCHORS[f.emotionOverall + 2] : "Not set" }}</div>
        </div>
      </Collapse>
    </template>
    <NightSheet v-if="nightOpen" :dream-id="id" :date="where.date" :nap="where.nap" :night-id="where.nightId" @moved="(d, n, id2) => Object.assign(where, { date: d, nap: n, nightId: id2 })" @close="nightOpen = false" />
  </div>
</template>

<style scoped>
.jed { display: flex; flex-direction: column; gap: var(--hg); min-width: 0; }
.jfull { position: fixed; inset: 0; z-index: 100; background: var(--bg); overflow-y: auto; overscroll-behavior: contain; padding: calc(var(--st) + var(--hg)) calc(var(--sr) + var(--hg)) calc(var(--sb) + var(--spg)) calc(var(--sl) + var(--hg)); }
.jbar { display: flex; align-items: center; gap: 8px; }
.jfull .jbar { position: sticky; top: calc(-1 * (var(--st) + var(--hg))); background: var(--bg); padding: var(--hg) 0; margin-top: calc(-1 * var(--hg)); z-index: 2; }
.jst { color: var(--tx2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jst.err { color: var(--neg); }
.jnight { align-self: flex-start; padding-left: 0; }
.jtitle { font-size: 18px; font-weight: 600; }
.jtext { min-height: 180px; resize: vertical; font-size: 16px; line-height: 1.55; }
.jfull .jtext { min-height: 42vh; }
.jchips { margin: 0; }
/* suggestions: quiet, so they read as an offer and not as part of the dream */
.jfound { display: flex; flex-wrap: wrap; gap: 6px; margin-top: calc(-1 * var(--hg) / 2); }
.jsg { display: inline-flex; align-items: center; gap: 4px; border: 1px dashed var(--ol); border-radius: var(--pill); padding: 2px 8px 2px 4px; color: var(--tx2); font-size: 13px; max-width: 100%; }
.jsgo { display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; color: var(--tx); font: inherit; padding: 2px 4px; cursor: pointer; min-width: 0; text-align: start; }
.jsgo:hover, .jsgo:focus-visible { color: var(--acc); }
.jkind { color: var(--tx2); font-size: 11px; margin-left: 2px; }
.jsg .jx { color: var(--tx2); padding: 2px; }
.jscale { display: flex; width: 100%; }
.jscale button { flex: 1; min-width: 0; }
.jan { margin-top: 6px; color: var(--tx2); }
.jels { margin-bottom: 8px; }
.jels .fchip { gap: 6px; }
.jx { border: 0; background: none; color: inherit; padding: 0; display: inline-grid; place-items: center; cursor: pointer; }
.jta { position: relative; }
.jsug { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5; padding: 4px var(--cpx); }
.jsug .li { width: 100%; background: none; border-left: 0; border-right: 0; border-top: 0; color: var(--tx); text-align: start; font: inherit; }
.jsug .li.hi, .jnew.hi { background: var(--s2); }
.jnew .li { background: none; }
.jkinds { margin: 0; padding: 0 0 var(--hg); }
.jmore { align-self: flex-start; padding-left: 0; }
.fld { margin-bottom: 0; }
</style>
