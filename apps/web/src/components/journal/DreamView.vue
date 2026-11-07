<script setup lang="ts">
// The dream page (PLAN.md §6.2, LDJ-15): the text with the elements found in it underlined (confirmed ones solid and
// opening their Signs page, suggestions dotted to confirm or reject), the night's facts, the marks, and the dreams
// that share elements. Read from the lists already on this device (opened there), so it shows offline too. Nothing
// leaves the device from here except the ordinary saves; the Markdown export is built here and saved as a file.
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { buildDreamMarkdown, dreamMarks, dreamSegments, ELEMENT_KIND_LABEL, fold, nightFacts, parseDismissed, relatedDreams, suggestionKey, summaryNote, type ElementKind, type Suggestion } from "@somnium/shared";
import { send } from "../../api/outbox";
import { invalidate } from "../../api/live";
import { deleteDream, useJournal } from "../../api/journal";
import { confirmSuggestion, rejectSuggestion, restoreDream, setDreamSign } from "../../api/dreamPage";
import { isPhone } from "../../core/device";
import { modelReady, suggestFromModel, summariseDream } from "../../core/localModel";
import { useSettings } from "../../api/queries";
import { useFmt } from "../../core/format";
import { toast, toastError } from "../../core/toast";
import Icon from "../Icon.vue";
import Menu, { type MenuItem } from "../Menu.vue";
import Sheet from "../Sheet.vue";
import DreamMedia from "./DreamMedia.vue";
import { lexiconsReady, loadLexicons, suggestElements } from "./detect";

const props = defineProps<{ id: string; back?: boolean }>();
const emit = defineEmits<{ edit: []; close: [] }>();
const router = useRouter();
const j = useJournal();
const fmt = useFmt();
onMounted(() => void loadLexicons());

const d = computed(() => j.dreams.data.value?.find((x) => x.id === props.id));
const night = computed(() => j.nights.data.value?.find((n) => n.id === d.value?.nightId));
const links = computed(() => (j.links.data.value ?? []).filter((l) => l.dreamId === props.id));
const byId = computed(() => new Map((j.elements.data.value ?? []).map((e) => [e.id, e])));
const els = computed(() => links.value.map((l) => byId.value.get(l.elementId)).filter((e): e is NonNullable<typeof e> => !!e?.name));

const marks = computed(() => (d.value ? dreamMarks(d.value) : []));
const flags = computed(() => (d.value?.favourite ? ["Favourite"] : []));
const facts = computed(() => nightFacts(night.value));

// "the app reads your dream": suggestions from the text, on this device, not yet confirmed (the editor's own rules)
const found = ref<Suggestion[]>([]);
const own = computed(() => (j.elements.data.value ?? []).map((e) => ({ id: e.id, name: e.name, kind: e.kind, aliases: e.aliases ?? null })));
const readKey = computed(() => JSON.stringify([d.value?.text, d.value?.dismissed, links.value.map((l) => l.elementId), own.value.length]));


const lexReady = ref(lexiconsReady());
loadLexicons().then(() => (lexReady.value = true));
watch([readKey, lexReady], () => {
  const x = d.value;
  found.value = x?.text && lexReady.value ? suggestElements(x.text, own.value, links.value.map((l) => l.elementId), parseDismissed(x.dismissed)) : [];
}, { immediate: true });

const segments = computed(() => dreamSegments(d.value?.text ?? "", j.elements.data.value ?? [], links.value, found.value));
const picked = ref("");
const pickedSug = computed(() => found.value.find((s) => s.key === picked.value));
const busy = ref(false);
async function act(f: () => Promise<void>) { if (busy.value) return; busy.value = true; try { await f(); } catch (e) { toastError(e); } finally { busy.value = false; } }
const confirmSug = (s: Suggestion) => act(async () => { picked.value = ""; await confirmSuggestion(props.id, s); });
const rejectSug = (s: Suggestion) => act(async () => { picked.value = ""; await rejectSuggestion(props.id, s.key); });
const openElement = (id: string) => router.push({ name: "signs-element", params: { id } });

// dreams that share elements
const related = computed(() => {
  const dates = new Map((j.dreams.data.value ?? []).map((x) => [x.id, x.date]));
  const signs = new Set((j.elements.data.value ?? []).filter((e) => e.isDreamSign).map((e) => e.id));
  return relatedDreams(props.id, j.links.data.value ?? [], signs, (id) => dates.get(id)).map((r) => ({
    ...r, title: j.dreams.data.value?.find((x) => x.id === r.id)?.title?.trim() || "Untitled dream",
    names: r.elementIds.map((e) => byId.value.get(e)?.name).filter(Boolean).join(", "),
  }));
});
const openDream = (id: string) => (isPhone.value ? router.push : router.replace)({ name: "journal-dream", params: { id } });

async function favourite() {
  // through the outbox: offline on the direct path it waits there (a yes or no, nothing sealed)
  try { await send("put", `/dreams/${props.id}`, { favourite: !d.value?.favourite }); invalidate(["journal"]); } catch (e) { toastError(e); }
}

// a file made here and saved by the browser: nothing goes to the server (the name is the date only)
function exportMd() {
  const x = d.value; if (!x) return;
  const { filename, markdown } = buildDreamMarkdown({ dream: x, night: night.value ?? null, elements: els.value });
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast("Exported");
}

// deleted at once, and brought back by Undo for six seconds; the toast never names or quotes the dream
async function remove() {
  const id = props.id;
  try { await deleteDream(id); } catch (e) { toastError(e); return; }
  emit("close");
  toast("Deleted", { ms: 6000, action: { label: "Undo", run: () => { restoreDream(id).catch(toastError); } } });
}

const signOpen = ref(false);
const signEls = computed(() => [...els.value].sort((a, b) => Number(a.isDreamSign) - Number(b.isDreamSign) || a.name!.localeCompare(b.name!)));
const toggleSign = (e: (typeof els.value)[number]) => act(() => setDreamSign(e.id, !e.isDreamSign));

// "Summarise with my model" (LDJ-42, optional, desktop app): only this dream's text goes to the person's own address, and only
// when asked. The summary is shown first; "Keep as a note" adds it to the night's sealed notes (a dream has no notes of its own).
const settings = useSettings();
const modelOn = computed(() => !!settings.value.features?.localModel && modelReady());
const mdl = ref<{ kind: "summary" | "elements"; summary?: string; els?: { kind: ElementKind; name: string }[] } | null>(null);
const asking = ref(false);
async function askModel(kind: "summary" | "elements") {
  const text = d.value?.text?.trim();
  if (!text) { toast("This dream has no text yet"); return; }
  if (asking.value) return;
  asking.value = true; toast("Asking your model…");
  try { mdl.value = kind === "summary" ? { kind, summary: await summariseDream(text) } : { kind, els: await suggestFromModel(text) }; }
  catch (e) { toastError(e); } finally { asking.value = false; }
}
const modelSugs = computed((): Suggestion[] => {
  const linked = new Set(links.value.map((l) => l.elementId));
  return (mdl.value?.els ?? []).map((e) => {
    const ex = (j.elements.data.value ?? []).find((x) => x.kind === e.kind && x.name && fold(x.name) === fold(e.name));
    return { key: suggestionKey(e.kind, e.name), type: "element" as const, kind: e.kind, name: ex?.name ?? e.name, existingElementId: ex?.id, spans: [], confidence: 0.5, sources: [] } satisfies Suggestion;
  }).filter((s) => !s.existingElementId || !linked.has(s.existingElementId));
});
const addModelSug = (s: Suggestion) => act(async () => { await confirmSuggestion(props.id, s); if (mdl.value?.els) mdl.value.els = mdl.value.els.filter((e) => suggestionKey(e.kind, e.name) !== s.key); });
const keepSummary = () => act(async () => {
  const n = night.value, sm = mdl.value?.summary;
  if (!n || !sm) return;
  await send("put", `/nights/${n.id}`, { notes: summaryNote(n.notes, sm) }); invalidate(["journal"]);
  mdl.value = null; toast("Kept in the night's notes");
});

// Share as text (optional, LDJ-41): the title and text go to another app only after this confirm, through the browser's
// share sheet, or onto the clipboard where there is none. Nothing is sent by Somnium itself.
const shareAsk = ref(false);
async function shareNow() {
  const x = d.value; shareAsk.value = false;
  if (!x) return;
  const title = x.title?.trim() || "Dream", text = x.text?.trim() || "";
  try {
    if (typeof navigator.share === "function") await navigator.share({ title, text });
    else { await navigator.clipboard.writeText(`${title}\n\n${text}`); toast("Copied"); }
  } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) toastError(e); }
}

const menu = computed((): MenuItem[] => [
  { label: "Summarise with my model", icon: "sparkle", hidden: !modelOn.value, run: () => askModel("summary") },
  { label: "Ask my model for elements", icon: "sparkle", hidden: !modelOn.value, run: () => askModel("elements") },
  { label: "Mark an element as a dream sign", icon: "target", hidden: !els.value.length, run: () => (signOpen.value = true) },
  { label: d.value?.favourite ? "Not a favourite" : "Favourite", icon: "star", run: favourite },
  { label: "Export as Markdown", icon: "download", hidden: !settings.value.features?.markdownExport, run: exportMd },
  { label: "Share as text", icon: "share", hidden: !settings.value.features?.shareText, run: () => (shareAsk.value = true) },
  { label: "Delete dream", icon: "trash", danger: true, sep: true, run: remove },
]);
</script>

<template>
  <div class="jview">
    <div class="jbar">
      <button v-if="back" class="ib sm plain" aria-label="Back" @click="emit('close')"><Icon name="left" :size="18" /></button>
      <div class="grow tiny jmut">{{ night ? fmt.date(night.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + (night.nap ? " · Nap" : "") : "" }}</div>
      <Menu v-if="d" :items="menu" />
      <button v-if="d" class="btn" @click="emit('edit')">Edit</button>
    </div>
    <div v-if="!d" class="card empty sm">This dream isn't here any more.</div>
    <template v-else>
      <h2 class="jt">{{ d.title?.trim() || "Untitled dream" }}</h2>
      <div v-if="flags.length" class="chips"><span v-for="m in flags" :key="m" class="fchip on">{{ m }}</span></div>

      <p class="jtx" :class="{ none: !d.text }">
        <template v-if="!d.text">No text yet.</template>
        <template v-else v-for="(s, i) in segments" :key="i">
          <button v-if="s.kind === 'linked'" class="dl" :aria-label="'Open ' + (byId.get(s.elementId)?.name ?? 'element')" @click="openElement(s.elementId)">{{ s.text }}</button>
          <button v-else-if="s.kind === 'suggested'" class="ds" :class="{ on: picked === s.key }" :aria-label="'Found: ' + s.text + '. Confirm or reject'" @click="picked = picked === s.key ? '' : s.key">{{ s.text }}</button>
          <template v-else>{{ s.text }}</template>
        </template>
      </p>

      <div v-if="pickedSug" class="card jpick" role="group" aria-label="Found in the text">
        <div class="grow"><b>{{ pickedSug.name }}</b><span class="tiny jmut"> · {{ ELEMENT_KIND_LABEL[pickedSug.kind] }}</span></div>
        <button class="qb acc" :disabled="busy" @click="confirmSug(pickedSug)"><Icon name="check" :size="14" />Confirm</button>
        <button class="qb" :disabled="busy" @click="rejectSug(pickedSug)"><Icon name="close" :size="14" />Not this</button>
      </div>
      <div v-if="found.length" class="jfound">
        <div class="tiny jmut">Found in the text · tap to confirm or reject</div>
        <div class="chips">
          <span v-for="s in found.slice(0, 8)" :key="s.key" class="jsg" :class="{ on: picked === s.key }">
            <button class="jsgo" :aria-label="'Add ' + s.name" @click="confirmSug(s)"><Icon name="plus" :size="12" />{{ s.name }}<span class="jkind">{{ ELEMENT_KIND_LABEL[s.kind] }}</span></button>
            <button class="jx" :aria-label="'Not ' + s.name" @click="rejectSug(s)"><Icon name="close" :size="12" /></button>
          </span>
        </div>
      </div>

      <DreamMedia :dream-id="id" />

      <section v-if="els.length" class="jsec">
        <div class="tiny jmut">Elements</div>
        <div class="chips">
          <button v-for="e in els" :key="e.id" class="fchip" :class="{ acc: e.isDreamSign }" @click="openElement(e.id)">{{ e.name }}<span v-if="e.isDreamSign" class="jkind">Dream sign</span></button>
        </div>
      </section>

      <section v-if="marks.length" class="jsec">
        <div class="tiny jmut">This dream</div>
        <div class="card"><div class="list"><div v-for="m in marks" :key="m.label" class="li"><div class="grow"><div class="s">{{ m.label }}</div><div class="t">{{ m.value }}</div></div></div></div></div>
      </section>

      <section v-if="facts.length" class="jsec">
        <div class="tiny jmut">The night</div>
        <div class="card"><div class="list"><div v-for="m in facts" :key="m.label" class="li"><div class="grow"><div class="s">{{ m.label }}</div><div class="t">{{ m.value }}</div></div></div></div></div>
      </section>

      <section v-if="related.length" class="jsec">
        <div class="tiny jmut">Related dreams</div>
        <div class="card"><div class="list">
          <button v-for="r in related" :key="r.id" class="li click jrel" @click="openDream(r.id)">
            <div class="grow"><div class="t">{{ r.title }}</div><div class="s">{{ fmt.date(r.date, { day: "numeric", month: "short", year: "numeric" }) }} · {{ r.shared }} shared<template v-if="r.names"> · {{ r.names }}</template></div></div>
            <Icon name="right" :size="16" />
          </button>
        </div></div>
      </section>
    </template>

    <Sheet v-if="shareAsk" title="Share this dream as text?" @close="shareAsk = false">
      <p class="jtx">This sends the dream's title and text outside Somnium, to the app you pick next (or onto your clipboard if this device has no share sheet). Once it leaves, Somnium can't take it back.</p>
      <div class="jpick"><button class="btn" data-testid="share-go" @click="shareNow">Share</button><button class="btn o" @click="shareAsk = false">Cancel</button></div>
    </Sheet>
    <Sheet v-if="mdl?.kind === 'summary'" title="Summary from my model" @close="mdl = null">
      <p class="jtx">{{ mdl.summary }}</p>
      <p class="tiny jmut">Written by the model you run, not checked by Somnium. Keeping it saves it, sealed, in this night's notes.</p>
      <div class="jpick"><button class="btn" :disabled="busy || !night" @click="keepSummary">Keep as a note</button><button class="btn o" @click="mdl = null">Discard</button></div>
    </Sheet>
    <Sheet v-if="mdl?.kind === 'elements'" title="Elements from my model" @close="mdl = null">
      <p v-if="!modelSugs.length" class="tiny jmut">Nothing new was suggested.</p>
      <p v-else class="tiny jmut">Suggestions, not yet in your dream. Add the ones that fit.</p>
      <div class="list">
        <div v-for="s in modelSugs" :key="s.key" class="li jrel"><div class="grow"><div class="t">{{ s.name }}</div><div class="s">{{ ELEMENT_KIND_LABEL[s.kind] }}</div></div>
          <button class="btn s" :disabled="busy" @click="addModelSug(s)">Add</button></div>
      </div>
    </Sheet>
    <Sheet v-if="signOpen" title="Dream signs" @close="signOpen = false">
      <p class="tiny jmut">Pick an element that keeps showing up. Signs are what you train to notice.</p>
      <div class="list">
        <button v-for="e in signEls" :key="e.id" class="li click jrel" role="switch" :aria-checked="e.isDreamSign" :disabled="busy" @click="toggleSign(e)">
          <div class="grow"><div class="t">{{ e.name }}</div><div class="s">{{ ELEMENT_KIND_LABEL[e.kind] }}</div></div>
          <span class="tiny" :class="e.isDreamSign ? 'jon' : 'jmut'">{{ e.isDreamSign ? "Dream sign" : "Mark" }}</span>
        </button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.jview { display: flex; flex-direction: column; gap: var(--hg); min-width: 0; }
.jbar { display: flex; align-items: center; gap: 8px; }
.jt { margin: 0; overflow-wrap: anywhere; }
.jtx { white-space: pre-wrap; line-height: 1.6; margin: 0; overflow-wrap: anywhere; }
.jtx.none { color: var(--tx2); }
.jmut { color: var(--tx2); }
.jon { color: var(--acc); font-weight: 600; }
.jsec, .jfound { display: flex; flex-direction: column; gap: calc(var(--hg) * .5); }
/* confirmed: a solid underline in the accent; found but not confirmed: dotted. Both are real buttons (keyboard, 44px reach by line height) */
.dl, .ds { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: inherit; white-space: inherit; }
.dl { text-decoration: underline; text-decoration-color: var(--acc); text-decoration-thickness: 2px; text-underline-offset: 3px; }
.ds { text-decoration: underline dotted; text-decoration-color: var(--tx2); text-decoration-thickness: 2px; text-underline-offset: 3px; }
.dl:hover, .dl:focus-visible { color: var(--acc); }
.ds:hover, .ds:focus-visible, .ds.on { color: var(--acc); text-decoration-color: var(--acc); }
.dl:focus-visible, .ds:focus-visible, .jsgo:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; border-radius: 3px; }
.jpick { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.jsg { display: inline-flex; align-items: center; gap: 4px; border: 1px dashed var(--ol); border-radius: var(--pill); padding: 2px 8px 2px 4px; color: var(--tx2); font-size: 13px; max-width: 100%; }
.jsg.on { border-color: var(--acc); }
.jsgo { display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; color: var(--tx); font: inherit; padding: 2px 4px; cursor: pointer; min-width: 0; text-align: start; }
.jsgo:hover { color: var(--acc); }
.jx { border: 0; background: none; color: var(--tx2); padding: 2px; cursor: pointer; display: inline-flex; }
.jx:hover, .jx:focus-visible { color: var(--tx); }
.jkind { font-size: 11px; color: var(--tx2); margin-inline-start: 4px; }
.jrel { width: 100%; background: none; border: 0; border-bottom: 1px solid var(--ol); color: inherit; font: inherit; text-align: start; cursor: pointer; }
.jrel:last-child { border-bottom: 0; }
</style>
