<script setup lang="ts">
// Tonight's plan (PLAN.md §6.1, §6.3; LDJ-96, LDJ-98): one component for both places that show it. On Train > Tonight
// (the one place to plan the night) it plans: the techniques (remove, or "Add a technique" from a sheet with their
// evidence badges), the intention, tonight's bedtime (the usual one from Settings > Sleep, changeable for tonight) and
// the WBTB alarm from the planner. On Home (`compact`) the same rows as a summary, the intention still editable here
// (the same field), and one button to Train > Tonight. The plain fields go through the outbox (api/train.ts), the
// intention through the sealed path (api/home.ts); the bedtime reminder follows the plan (native/reminders.ts).
// The technique names come from the page (`titleOf`), so Home keeps loading Learn's texts alongside its queries; the
// picker sheet loads only when opened.
// LDJ-108: with nothing planned it shows the suggested plan from the current lesson and the nights you can sleep in
// (packages/shared/src/tonight.ts, with its reason and sources): "Use this plan" puts it on the night in one tap, with
// the WBTB alarm as the planner would set it, and the intention when none is set; "Change" opens the picker. On Home
// (`compact`) only its name, under the button to Train > Tonight.
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { bedtimeAt, currentLesson, freeNightsOf, suggestTonight, wbtbNightsOf, type TonightIdea } from "@somnium/shared";
import { parseInline } from "@somnium/knowledge/markdown";
import { applyTonightPlan, planTonight, setTonightBedtime, useCourse } from "../../api/train";
import { useJournal } from "../../api/journal";
import { setWbtbAlarm } from "../../native/reminders";
import { askAlarmPermission, wbtbForMild } from "./wbtbDefaults";
import LearnInline from "../learn/LearnInline.vue";
import { saveIntention } from "../../api/home";
import type { NightRow } from "../../api/journal";
import { useChange, useSettings } from "../../api/queries";
import { useFmt } from "../../core/format";
import "../../styles/components/tonight.css";
import Icon from "../Icon.vue";
import TimePicker from "../TimePicker.vue";
const TonightPicker = defineAsyncComponent(() => import("./TonightPicker.vue"));
const SourceSheet = defineAsyncComponent(() => import("../learn/SourceSheet.vue"));

const props = defineProps<{ night: NightRow | undefined; date: string; titleOf: (id: string) => string; compact?: boolean; same?: boolean }>();
const settings = useSettings();
const fmt = useFmt();

// WBTB has its own row (the alarm), so the list holds the rest of the plan
const planned = computed(() => (props.night?.techniquesPlanned ?? []).filter((id) => id !== "wbtb").map((id) => ({ id, title: props.titleOf(id) })));

// ---- the techniques: remove here, add from the sheet (TonightPicker)
const remove = useChange((id: string) => planTonight(id, false), ["journal", "train", "home"]);
const picking = ref(false);

// ---- the intention: sealed on the night (api/home.ts)
const text = ref(props.night?.intention ?? "");
const editing = ref(false);
watch(() => props.night?.intention, (v) => { if (!editing.value) text.value = v ?? ""; });
const save = useChange(async () => { await saveIntention(props.date, text.value); editing.value = false; }, ["journal", "home"]);
const cancel = () => { text.value = props.night?.intention ?? ""; editing.value = false; };

// ---- bedtime and the WBTB alarm
const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const usual = computed(() => settings.value.sleep.bedtime);
const bed = computed(() => (props.night?.bedtime ? hm(props.night.bedtime) : usual.value));
const bedIso = computed(() => bedtimeAt(props.date, bed.value).toISOString());
const alarm = computed(() => props.night?.wbtbWakeAt ?? null);
const setBed = useChange((v: string) => setTonightBedtime(!v || v === usual.value ? null : bedtimeAt(props.date, v)), ["journal", "train", "home"]);
const summary = computed(() => `Bed at ${fmt.value.time(bedIso.value)} · ${alarm.value ? `WBTB alarm ${fmt.value.time(alarm.value)}` : "No alarm"}`);
const anything = computed(() => planned.value.length > 0 || !!alarm.value || !!props.night?.intention);

// ---- the suggested plan (LDJ-108), only while nothing is planned
const j = useJournal();
const course = useCourse();
const suggestion = computed(() => {
  const rows = course.data.value;
  if (!rows) return null;
  const s = settings.value;
  // WBTB nights used or planned, tonight's own left out: not two in a row, at most 3 a week
  const wbtbNights = wbtbNightsOf(j.nights.data.value ?? [], props.date);
  return suggestTonight({ lesson: currentLesson(rows), date: props.date, freeNights: freeNightsOf(s.sleep.freeNights), sleepFirst: s.safety.sleepFirst, safetyChecked: s.safety.checked, wbtbNights });
});
// the alarm the WBTB planner would set (its kept mode and cycle length, wbtbDefaults.ts), never its nap mode
const wbtb = computed(() => wbtbForMild(new Date(bedIso.value), settings.value.sleep.cycle));
const wbtbAt = computed(() => wbtb.value.at);
const ideaTitle = (i: TonightIdea) => (i.wbtb ? `${i.title} · alarm ${fmt.value.time(wbtbAt.value.toISOString())}` : i.title);
const cite = ref<string[] | null>(null);
const use = useChange(async (i: TonightIdea) => {
  const w = i.wbtb ? wbtb.value : null, at = w?.at ?? null;
  // asked first, while the tap still counts as the person's own (as the planner does before setting its alarm)
  if (at) await askAlarmPermission();
  await applyTonightPlan(i.techniques, w ? { at: w.at, mode: w.mode } : null);
  if (at) await setWbtbAlarm(at.getTime());
  if (!props.night?.intention && suggestion.value) { await saveIntention(props.date, suggestion.value.intention); text.value = suggestion.value.intention; }
}, ["journal", "train", "home"]);
</script>

<template>
  <section class="tplan" :class="{ compact }">
    <div class="sh"><h2>{{ compact ? "Tonight" : "Tonight's plan" }}</h2></div>
    <div class="card">
      <div v-if="same" class="tiny tpnote">Before 05:00 tonight is the night you are in.</div>

      <div v-if="planned.length" class="tplist">
        <div v-for="p in planned" :key="p.id" class="li tpli">
          <Icon name="moon" :size="18" />
          <router-link :to="'/train/technique/' + p.id" class="grow t tpname">{{ p.title }}</router-link>
          <button v-if="!compact" type="button" class="ib sm plain" :aria-label="'Remove ' + p.title" :title="'Remove ' + p.title" :disabled="remove.busy.value" @click="remove.run(p.id)"><Icon name="close" :size="16" /></button>
        </div>
      </div>
      <div v-else-if="suggestion && !anything && compact" class="tiny tpnone">Suggested: {{ ideaTitle(suggestion) }}</div>
      <div v-else-if="suggestion && !anything" class="tpsug">
        <div class="tiny">Suggested for tonight</div>
        <div class="t">{{ ideaTitle(suggestion) }}</div>
        <p class="tiny tpwhy"><LearnInline :nodes="parseInline(suggestion.reason)" @cite="cite = $event" /></p>
        <p v-if="suggestion.noWbtb" class="tiny tpwhy"><LearnInline :nodes="parseInline(suggestion.noWbtb)" @cite="cite = $event" /></p>
        <div class="tprow">
          <button type="button" class="btn s" :class="{ tonal: compact }" :disabled="use.busy.value" @click="use.run(suggestion)">Use this plan</button>
          <button type="button" class="qb acc" @click="picking = true">Change</button>
        </div>
        <template v-if="suggestion.alt">
          <p class="tiny tpwhy"><LearnInline :nodes="parseInline(suggestion.alt.reason)" @cite="cite = $event" /></p>
          <button type="button" class="qb acc tpadd" :disabled="use.busy.value" @click="use.run(suggestion.alt)">Use {{ ideaTitle(suggestion.alt) }}</button>
        </template>
      </div>
      <div v-else class="empty sm"><Icon name="moon" :size="34" /><b>No technique planned yet</b>Pick one to try tonight.<br /><button class="btn tonal" type="button" @click="picking = true">Pick a technique</button></div>
      <button v-if="!compact && planned.length && (anything || !suggestion)" type="button" class="qb acc tpadd" @click="picking = true"><Icon name="plus" :size="16" />Add a technique</button>

      <div class="tpsec">
        <div v-if="!editing" class="tprow">
          <div class="grow"><div class="t">Intention</div><div class="tiny tpx">{{ night?.intention || "None set" }}</div></div>
          <button type="button" class="qb acc" @click="editing = true"><Icon name="edit" :size="16" />{{ night?.intention ? "Change" : "Set an intention" }}</button>
        </div>
        <form v-else class="tpedit" @submit.prevent="save.run()">
          <label class="t" :for="compact ? 'h-intention' : 't-intention'">Intention</label>
          <input :id="compact ? 'h-intention' : 't-intention'" v-model="text" type="text" maxlength="200" placeholder="Next time I dream, I will notice I am dreaming" autocomplete="off" @keydown.esc="cancel" />
          <div class="tprow"><span class="grow" /><button type="button" class="qb" @click="cancel">Cancel</button><button type="submit" class="btn o s" :disabled="save.busy.value">Save</button></div>
        </form>
      </div>

      <template v-if="compact">
        <div class="tpsec tprow">
          <div class="grow tiny">{{ summary }}</div>
          <router-link to="/train/tonight" class="btn o s">{{ anything ? "Change" : "Plan tonight" }}</router-link>
        </div>
      </template>
      <template v-else>
        <div class="tpsec tprow">
          <div class="grow"><div class="t">Bedtime</div><div class="tiny">{{ night?.bedtime && bed !== usual ? `Tonight only · usual ${fmt.time(bedtimeAt(date, usual).toISOString())}` : "Your usual (Settings, Sleep)" }}</div></div>
          <TimePicker :model-value="bed" title="Bedtime tonight" :disabled="setBed.busy.value" @update:model-value="(v) => setBed.run(v)" />
        </div>
        <div class="tpsec tprow">
          <div class="grow"><div class="t">WBTB alarm</div><div class="tiny">{{ alarm ? fmt.time(alarm) : "No alarm" }}</div></div>
          <router-link to="/train/guided/wbtb" class="qb acc"><Icon name="clock" :size="16" />{{ alarm ? "Change" : "Plan WBTB" }}</router-link>
        </div>
      </template>
    </div>

    <SourceSheet v-if="cite" :ids="cite" @close="cite = null" />
    <TonightPicker v-if="picking" :planned="night?.techniquesPlanned ?? []" :title-of="titleOf" @close="picking = false" />
  </section>
</template>
