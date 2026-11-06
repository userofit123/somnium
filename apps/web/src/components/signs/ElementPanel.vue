<script setup lang="ts">
// An element's page (PLAN.md §6.3): every dream it is in, what turns up with it, how often dreams with it were lucid
// against dreams without it, and its name, kind, other names and dream sign mark to change.
import { computed, reactive, ref } from "vue";
import { coOccurrence, ELEMENT_KINDS, frequencyText, lucidSplit, pairedCheck, SIGN_ADVICE, SIGN_CATEGORIES, signFrequency, type SignCategory } from "@somnium/shared";
import { mergeElements, saveElement, signLexicons } from "../../api/signs";
import { choose } from "../../core/ask";
import { useFmt } from "../../core/format";
import { toast, toastError } from "../../core/toast";
import Icon from "../Icon.vue";
import Menu from "../Menu.vue";
import Sheet from "../Sheet.vue";
import AppSelect from "../AppSelect.vue";
import BarChart from "../BarChart.vue";
import { CATEGORY_LABEL, KIND_ONE, dreamsText, useSigns } from "./useSigns";

const props = defineProps<{ id: string; back?: boolean }>();
const emit = defineEmits<{ close: []; open: [id: string] }>();
const fmt = useFmt();
const { elements, links, dreams, byId, stats } = useSigns();
const el = computed(() => byId.value.get(props.id));
const stat = computed(() => stats.value.get(props.id));
const live = computed(() => new Set(dreams.value.map((d) => d.id)));
const its = computed(() => { const ids = new Set(stat.value?.dreamIds ?? []); return dreams.value.filter((d) => ids.has(d.id)); });
const along = computed(() => coOccurrence(props.id, links.value, live.value).map((c) => ({ ...c, el: byId.value.get(c.elementId) })).filter((c) => c.el?.name).slice(0, 12));
const split = computed(() => lucidSplit(props.id, links.value, dreams.value));
const pct = (a: number, n: number) => (n ? `${Math.round((a / n) * 100)}%` : "-");
const freq = computed(() => (stat.value ? frequencyText(signFrequency(stat.value, dreams.value)) : ""));
const check = computed(() => (el.value?.isDreamSign || el.value?.signCategory ? pairedCheck(el.value.signCategory, signLexicons.value?.checks ?? []) : null));
// the 12 weeks as bars, labelled by the date each week starts
const weeks = computed(() => (stat.value?.weekly ?? []).map((v, i, a) => {
  const d = new Date(); d.setDate(d.getDate() - (a.length - 1 - i) * 7 - 6);
  return { label: fmt.value.date(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, { day: "numeric", month: "short" }), value: v };
}));
const label = (d: { title: string | null; text: string | null }) => d.title?.trim() || d.text?.trim().slice(0, 80) || "Untitled dream";

// editing
const editing = ref(false), saving = ref(false);
const f = reactive({ name: "", kind: "object" as (typeof ELEMENT_KINDS)[number], aliases: "", isDreamSign: false, signCategory: null as SignCategory | null });
function edit() {
  const e = el.value; if (!e) return;
  Object.assign(f, { name: e.name ?? "", kind: e.kind, aliases: e.aliases ?? "", isDreamSign: e.isDreamSign, signCategory: e.signCategory });
  editing.value = true;
}
async function save() {
  if (!f.name.trim()) return;
  saving.value = true;
  try {
    await saveElement(props.id, { name: f.name.trim(), kind: f.kind, aliases: f.aliases.trim() || null, isDreamSign: f.isDreamSign, signCategory: f.isDreamSign || f.kind === "dream_sign" ? f.signCategory : null });
    editing.value = false; toast("Saved");
  } catch (e) { toastError(e); } finally { saving.value = false; }
}
async function markSign(on: boolean) {
  const e = el.value; if (!e) return;
  let cat: SignCategory | null = e.signCategory;
  if (on) {
    const c = await choose("Which kind of dream sign?", [...SIGN_CATEGORIES.map((x) => ({ label: CATEGORY_LABEL[x], value: x })), { label: "Not sure", value: "" }], "LaBerge's four categories: inner awareness (a thought or feeling), action (something impossible happens), form (something looks wrong) and context (something is where it shouldn't be).");
    if (c === null) return;
    cat = (c || null) as SignCategory | null;
  }
  try { await saveElement(e.id, { name: e.name ?? "", kind: e.kind, aliases: e.aliases, isDreamSign: on, signCategory: on ? cat : e.kind === "dream_sign" ? e.signCategory : null }); toast(on ? "Marked as a dream sign" : "No longer a dream sign"); }
  catch (x) { toastError(x); }
}
async function mergeInto() {
  const e = el.value; if (!e) return;
  const others = elements.value.filter((x) => x.id !== e.id && x.name)
    .sort((a, b) => Number(b.kind === e.kind) - Number(a.kind === e.kind) || (stats.value.get(b.id)?.dreamCount ?? 0) - (stats.value.get(a.id)?.dreamCount ?? 0)).slice(0, 40);
  if (!others.length) { toast("There is nothing else to merge it into yet"); return; }
  const into = await choose(`Merge "${e.name}" into`, others.map((x) => ({ label: `${x.name} · ${KIND_ONE[x.kind]}`, value: x.id })), "Its dreams move over, and its name is kept as another name for the one you pick.");
  const target = into ? byId.value.get(into) : undefined;
  if (!target) return;
  try { await mergeElements(e, target, links.value); toast("Merged"); emit("open", target.id); } catch (x) { toastError(x); }
}
const menu = computed(() => [
  { label: "Mark as a dream sign", icon: "sparkle", run: () => markSign(true), hidden: !!el.value?.isDreamSign },
  { label: "Not a dream sign", icon: "close", run: () => markSign(false), hidden: !el.value?.isDreamSign },
  { label: "Merge into another", icon: "layers", run: mergeInto },
]);
</script>

<template>
  <div v-if="!el" class="empty sm">
    <div v-if="back"><button class="ib sm plain" aria-label="Back" @click="emit('close')"><Icon name="left" :size="18" /></button></div>
    This element isn't in your journal any more.
  </div>
  <div v-else class="sgp">
    <div class="sgph">
      <button v-if="back" class="ib sm plain" aria-label="Back" @click="emit('close')"><Icon name="left" :size="18" /></button>
      <div class="grow sgmin"><div class="sgt">{{ el.name }}</div>
        <div class="tiny sgmut">{{ [KIND_ONE[el.kind], el.isDreamSign && el.kind !== "dream_sign" ? "Dream sign" : "", el.signCategory ? CATEGORY_LABEL[el.signCategory] : "", el.confirmed ? "" : "Not confirmed"].filter(Boolean).join(" · ") }}</div></div>
      <Menu :items="menu" />
      <button class="btn" @click="edit"><Icon name="edit" :size="16" />Edit</button>
    </div>
    <div v-if="el.aliases" class="tiny sgmut">Also called {{ el.aliases }}</div>

    <div class="sgstats">
      <div><div class="num sgbig">{{ stat?.dreamCount ?? 0 }}</div><div class="tiny sgmut">{{ (stat?.dreamCount ?? 0) === 1 ? "dream" : "dreams" }}</div></div>
      <div><div class="num sgbig">{{ stat?.lastSeen ? fmt.date(stat.lastSeen, { day: "numeric", month: "short" }) : "-" }}</div><div class="tiny sgmut">last seen</div></div>
      <div><div class="num sgbig">{{ stat?.recent30 ?? 0 }}</div><div class="tiny sgmut">in 30 days</div></div>
    </div>
    <div v-if="freq" class="tiny sgmut">Seen {{ freq }}.</div>

    <div v-if="check" class="sgbox">
      <div class="t"><Icon name="target" :size="15" class="sgacc" /> Pair it with: {{ check.name }}</div>
      <div class="tiny">{{ SIGN_ADVICE[el.signCategory ?? "none"] }} {{ check.howTo }}</div>
    </div>

    <h3 class="sgh">Last 12 weeks</h3>
    <BarChart :bars="weeks" :height="110" />

    <h3 class="sgh">Lucid or not</h3>
    <div class="tiny">Lucid in {{ split.with.lucid }} of {{ dreamsText(split.with.dreams) }} with it ({{ pct(split.with.lucid, split.with.dreams) }}) · {{ split.without.lucid }} of {{ dreamsText(split.without.dreams) }} without it ({{ pct(split.without.lucid, split.without.dreams) }}).</div>
    <div v-if="split.with.dreams < 5" class="tiny sgmut">Too few dreams to read much into this yet.</div>

    <template v-if="along.length">
      <h3 class="sgh">Often with it</h3>
      <div class="chips"><button v-for="c in along" :key="c.elementId" class="fchip" @click="emit('open', c.elementId)">{{ c.el!.name }} · {{ c.count }}</button></div>
    </template>

    <h3 class="sgh">Dreams</h3>
    <div v-if="!its.length" class="tiny sgmut">Not in any dream now.</div>
    <div v-else class="list">
      <RouterLink v-for="d in its" :key="d.id" class="li click sglink" :to="{ name: 'journal-dream', params: { id: d.id } }">
        <Icon :name="d.lucid ? 'sparkle' : 'book'" :size="16" :class="d.lucid ? 'sgacc' : 'sgmut'" :aria-label="d.lucid ? 'Lucid' : undefined" />
        <div class="grow sgmin"><div class="t ellipsis">{{ label(d) }}</div><div class="s">{{ [fmt.date(d.date, { day: "numeric", month: "short", year: "numeric" }), d.lucid ? "Lucid" : ""].filter(Boolean).join(" · ") }}</div></div>
      </RouterLink>
    </div>

    <Sheet v-if="editing" title="Edit element" @close="editing = false">
      <div class="fld"><label>Name</label><input v-model="f.name" maxlength="120" /></div>
      <div class="fld"><label>Kind</label><AppSelect v-model="f.kind" :options="ELEMENT_KINDS.map((k) => ({ value: k, label: KIND_ONE[k] }))" /></div>
      <div class="fld"><label>Other names</label><input v-model="f.aliases" placeholder="Comma separated" /></div>
      <label class="tgl"><div class="grow"><div class="t">Dream sign</div><div class="tiny">Something that tells you you might be dreaming</div></div><span class="tg"><input v-model="f.isDreamSign" type="checkbox" /></span></label>
      <div v-if="f.isDreamSign || f.kind === 'dream_sign'" class="fld"><label>Category</label>
        <AppSelect v-model="f.signCategory" :options="[{ value: null, label: 'Not sure' }, ...SIGN_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]" /></div>
      <template #foot><button class="btn o" @click="editing = false">Cancel</button><button class="btn" :disabled="saving || !f.name.trim()" @click="save">Save</button></template>
    </Sheet>
  </div>
</template>

<style scoped>
.sgp { display: flex; flex-direction: column; gap: var(--hg); }
.sgph { display: flex; align-items: center; gap: 8px; }
.sgt { font-size: 20px; font-weight: 600; line-height: 1.25; overflow-wrap: anywhere; }
.sgmin { min-width: 0; }
.sgmut { color: var(--tx2); }
.sgacc { color: var(--acc); }
.sgstats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--hg); }
.sgbig { font-size: 20px; font-weight: 600; }
.sgbox { background: var(--s2); border-radius: var(--r-sm); padding: var(--hg); display: flex; flex-direction: column; gap: 4px; }
.sgbox .t { font-weight: 500; display: flex; align-items: center; gap: 6px; }
.sgh { margin: var(--hg) 0 0; font-size: 14px; }
.sglink { color: var(--tx); text-decoration: none; }
</style>
