<script setup lang="ts">
// The night a dream belongs to (PLAN.md §6.2): its date (which night), bedtime, wake time, sleep quality, WBTB,
// whether it was a nap, techniques used and the minutes to fall asleep after them, substances and notes. Saved as it changes, with the dream (api/journal.ts).
import { computed, reactive, ref, watch } from "vue";
import { clockOf, minutesToSleep, nightClock, nightOfDate, SLEEP_ANCHORS, TECHNIQUES } from "@somnium/shared";
import { changeNight, liveDraft, moveDream, useJournal, uuidv7 } from "../../api/journal";
import { localYmd } from "../../core/format";
import Sheet from "../Sheet.vue";
import DatePicker from "../DatePicker.vue";
import TimePicker from "../TimePicker.vue";
import NumStep from "../NumStep.vue";
import ChoiceTiles from "../ChoiceTiles.vue";

const props = defineProps<{ dreamId: string; date: string; nap: boolean; nightId: string }>();
const emit = defineEmits<{ close: []; moved: [date: string, nap: boolean, nightId: string] }>();
const j = useJournal();
const today = localYmd(new Date());

const n = reactive({ date: props.date, nap: props.nap, nightId: props.nightId, bedtime: "", wakeTime: "", sleepQuality: null as number | null, wbtbUsed: false, wbtbMinutesAwake: null as number | null, minutesToSleep: null as number | null, techniquesDone: [] as string[], substances: "", notes: "" });
const ready = ref(false);
// the night's values: the row there, with what was changed here and not sent yet on top
function fill() {
  ready.value = false;
  const row = (j.nights.data.value ?? []).find((x) => x.id === n.nightId);
  const own = liveDraft(props.dreamId)?.night ?? {};
  const v = { ...(row ?? {}), ...own } as Record<string, any>;
  n.bedtime = clockOf(v.bedtime); n.wakeTime = clockOf(v.wakeTime);
  n.sleepQuality = v.sleepQuality ?? null; n.wbtbUsed = !!v.wbtbUsed; n.wbtbMinutesAwake = v.wbtbMinutesAwake ?? null;
  n.minutesToSleep = minutesToSleep(v);
  n.techniquesDone = [...(v.techniquesDone ?? [])]; n.substances = v.substances ?? ""; n.notes = v.notes ?? "";
  queueMicrotask(() => (ready.value = true));
}
fill();

function move(date: string, nap: boolean) {
  if (!date) return;
  const nights = j.nights.data.value ?? [];
  const id = nap ? uuidv7() : nightOfDate(nights, date)?.id ?? uuidv7();
  Object.assign(n, { date, nap, nightId: id });
  moveDream(props.dreamId, date, nap, id);
  emit("moved", date, nap, id);
  fill();
}
const put = (patch: Record<string, unknown>) => { if (ready.value) changeNight(props.dreamId, patch); };
watch(() => n.bedtime, (v) => put({ bedtime: v ? nightClock(n.date, v, "bed") : null }));
watch(() => n.wakeTime, (v) => put({ wakeTime: v ? nightClock(n.date, v, "wake") : null }));
watch(() => n.sleepQuality, (v) => put({ sleepQuality: v }));
watch(() => n.wbtbUsed, (v) => put({ wbtbUsed: v }));
watch(() => n.wbtbMinutesAwake, (v) => put({ wbtbMinutesAwake: v }));
// sealed on the way out (sealed.ts): sent as a number, it opens again as text
watch(() => n.minutesToSleep, (v) => put({ minutesToSleep: v }));
watch(() => n.techniquesDone, (v) => put({ techniquesDone: [...v] }), { deep: true });
watch(() => n.substances, (v) => put({ substances: v }));
watch(() => n.notes, (v) => put({ notes: v }));

const techs = TECHNIQUES.map((t) => ({ value: t.id, label: t.label }));
const quality = computed(() => (n.sleepQuality ? SLEEP_ANCHORS[n.sleepQuality - 1] : "Not set"));
</script>

<template>
  <Sheet title="Night details" @close="emit('close')">
    <div class="fld"><label>Night of (the morning's date)</label><DatePicker :model-value="n.date" :max="today" @update:model-value="(v) => move(v, n.nap)" /></div>
    <label class="tgl"><div class="grow"><div class="t">A nap</div><div class="s">Kept apart from the night of the same date</div></div><span class="tg"><input type="checkbox" :checked="n.nap" @change="move(n.date, ($event.target as HTMLInputElement).checked)" /></span></label>
    <div class="g2 jg">
      <div class="fld"><label>Went to bed</label><TimePicker v-model="n.bedtime" clearable /></div>
      <div class="fld"><label>Woke up</label><TimePicker v-model="n.wakeTime" clearable /></div>
    </div>
    <div class="fld">
      <label>Sleep quality</label>
      <div class="seg jscale" role="group" aria-label="Sleep quality"><button v-for="q in 5" :key="q" type="button" :class="{ on: n.sleepQuality === q }" :aria-pressed="n.sleepQuality === q" @click="n.sleepQuality = n.sleepQuality === q ? null : q">{{ q }}</button></div>
      <div class="tiny jan">{{ quality }}</div>
    </div>
    <label class="tgl"><div class="grow"><div class="t">Wake back to bed</div><div class="s">Woke up on purpose, stayed up a while, went back to sleep</div></div><span class="tg"><input v-model="n.wbtbUsed" type="checkbox" /></span></label>
    <div v-if="n.wbtbUsed" class="fld"><label>Minutes awake</label><NumStep :value="n.wbtbMinutesAwake" :min="0" :max="600" :step="5" unit="min" @set="(v) => (n.wbtbMinutesAwake = v)" /></div>
    <div class="fld"><label>Techniques used</label><ChoiceTiles v-model="n.techniquesDone" :options="techs" multiple compact /></div>
    <div v-if="n.techniquesDone.length || n.wbtbUsed" class="fld">
      <label>Minutes to fall asleep after the technique</label>
      <NumStep :value="n.minutesToSleep" :min="0" :max="600" :step="5" unit="min" @set="(v) => (n.minutesToSleep = v)" />
      <div class="tiny jan">A guess is fine. Insights compares nights asleep within 10 minutes with longer ones.</div>
    </div>
    <div class="fld"><label>Substances</label><input aria-label="Substances" v-model="n.substances" placeholder="Caffeine, alcohol, supplements, medicines" maxlength="500" /></div>
    <div class="fld"><label>Notes</label><textarea aria-label="Notes" v-model="n.notes" rows="3" placeholder="Anything else about the night" /></div>
  </Sheet>
</template>

<style scoped>
.jg { gap: var(--hg); }
.jscale { display: flex; width: 100%; }
.jscale button { flex: 1; min-width: 0; }
.jan { margin-top: 6px; color: var(--tx2); }
</style>
