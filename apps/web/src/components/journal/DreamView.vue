<script setup lang="ts">
// A dream to read: a minimal view until LDJ-15 builds the full dream page. Read from the lists already on this
// device (opened there), so it shows offline too.
import { computed } from "vue";
import { clockOf, CONTROL_ANCHORS, EMOTION_ANCHORS, LUCIDITY_ANCHORS, RECALL_ANCHORS, SLEEP_ANCHORS, TECHNIQUES, VIVIDNESS_ANCHORS } from "@somnium/shared";
import { send } from "../../api/outbox";
import { invalidate } from "../../api/live";
import { deleteDream, useJournal } from "../../api/journal";
import { useFmt } from "../../core/format";
import { confirm } from "../../core/ask";
import { toastError } from "../../core/toast";
import Icon from "../Icon.vue";
import Menu from "../Menu.vue";

const props = defineProps<{ id: string; back?: boolean }>();
const emit = defineEmits<{ edit: []; close: [] }>();
const j = useJournal();
const fmt = useFmt();
const d = computed(() => j.dreams.data.value?.find((x) => x.id === props.id));
const night = computed(() => j.nights.data.value?.find((n) => n.id === d.value?.nightId));
const els = computed(() => (j.links.data.value ?? []).filter((l) => l.dreamId === props.id).map((l) => j.elements.data.value?.find((e) => e.id === l.elementId)).filter((e) => e?.name));
const marks = computed(() => { const x = d.value; if (!x) return []; return [x.lucid && "Lucid", x.nightmare && "Nightmare", x.recurring && "Recurring", x.falseAwakening && "False awakening", x.sleepParalysis && "Sleep paralysis", x.favourite && "Favourite"].filter(Boolean) as string[]; });
const scales = computed(() => {
  const x = d.value; if (!x) return [];
  return [
    x.lucid && ["Lucidity", `${x.lucidityLevel} · ${LUCIDITY_ANCHORS[x.lucidityLevel]}`],
    x.vividness && ["Vividness", `${x.vividness} · ${VIVIDNESS_ANCHORS[x.vividness - 1]}`],
    x.control != null && ["Control", `${x.control} · ${CONTROL_ANCHORS[x.control]}`],
    x.recallClarity && ["Recall clarity", `${x.recallClarity} · ${RECALL_ANCHORS[x.recallClarity - 1]}`],
    x.emotionOverall != null && ["Overall emotion", EMOTION_ANCHORS[x.emotionOverall + 2]!],
  ].filter(Boolean) as [string, string][];
});
const facts = computed(() => {
  const n = night.value; if (!n) return "";
  return [n.bedtime && `Bed ${clockOf(n.bedtime)}`, n.wakeTime && `Up ${clockOf(n.wakeTime)}`, n.sleepQuality && `Sleep ${SLEEP_ANCHORS[n.sleepQuality - 1]!.toLowerCase()}`,
    n.wbtbUsed && `WBTB${n.wbtbMinutesAwake ? ` ${n.wbtbMinutesAwake} min` : ""}`, ...(n.techniquesDone ?? []).map((t) => TECHNIQUES.find((x) => x.id === t)?.label ?? t)].filter(Boolean).join(" · ");
});
async function favourite() {
  // through the outbox: offline on the direct path it waits there (a yes or no, nothing sealed)
  try { await send("put", `/dreams/${props.id}`, { favourite: !d.value?.favourite }); invalidate(["journal"]); } catch (e) { toastError(e); }
}
async function remove() {
  if (!(await confirm("Delete this dream?", { ok: "Delete", danger: true }))) return;
  try { await deleteDream(props.id); emit("close"); } catch (e) { toastError(e); }
}
const menu = computed(() => [
  { label: d.value?.favourite ? "Not a favourite" : "Favourite", icon: "star", run: favourite },
  { label: "Delete dream", icon: "trash", danger: true, run: remove },
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
      <div v-if="marks.length" class="chips"><span v-for="m in marks" :key="m" class="fchip on">{{ m }}</span></div>
      <p class="jtx">{{ d.text || "No text yet." }}</p>
      <div v-if="els.length" class="chips"><span v-for="e in els" :key="e!.id" class="fchip">{{ e!.name }}</span></div>
      <div v-if="scales.length" class="card"><div class="list"><div v-for="[k, v] in scales" :key="k" class="li"><div class="grow"><div class="s">{{ k }}</div><div class="t">{{ v }}</div></div></div></div></div>
      <div v-if="facts" class="tiny jmut">{{ facts }}</div>
    </template>
  </div>
</template>

<style scoped>
.jview { display: flex; flex-direction: column; gap: var(--hg); min-width: 0; }
.jbar { display: flex; align-items: center; gap: 8px; }
.jt { margin: 0; overflow-wrap: anywhere; }
.jtx { white-space: pre-wrap; line-height: 1.6; margin: 0; overflow-wrap: anywhere; }
.jmut { color: var(--tx2); }
</style>
