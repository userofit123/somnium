<script setup lang="ts">
// The weekly review (LDJ-155, optional feature "Weekly review"): two minutes on the last evening of the week. This week
// against last as stat tiles, a few plain observations and one recommendation with their sources (packages/shared/src/
// week.ts), then next week's two choices: the WBTB nights (settings.sleep.freeNights, the same chips as Settings,
// which Tonight's suggested plan reads) and the target dream sign (settings.week.sign). Both save through the settings
// outbox, so they work offline. "Done" ticks the "weekly review" habit. Counts and one sign name only, never dream text.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { weekSummary, WEEK_REVIEW_HABIT, type InsightCheck } from "@somnium/shared";
import { useJournal, type NightRow } from "../../api/journal";
import { useTrain, useHabitLog, tickPractice } from "../../api/train";
import { saveSettings, useChange, useSettings } from "../../api/queries";
import { useToday } from "../../core/today";
import { useFmt } from "../../core/format";
import { goBack, backLabel } from "../../core/leave";
import Icon from "../Icon.vue";
import CiteChips from "../learn/CiteChips.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import FreeNights from "../settings/FreeNights.vue";

const router = useRouter();
const settings = useSettings();
const j = useJournal(), t = useTrain(), log = useHabitLog(), today = useToday(), fmt = useFmt();
const back = backLabel(router, "Train");
const open = ref<string[] | null>(null);

const w = computed(() => weekSummary({
  nights: (j.nights.data.value ?? []) as NightRow[], dreams: j.dreams.data.value ?? [], elements: j.elements.data.value ?? [], links: j.links.data.value ?? [],
  checks: (t.checks.data.value ?? []) as InsightCheck[],
}, today.value));
const range = computed(() => `${fmt.value.date(w.value.now.from)} - ${fmt.value.date(w.value.now.to)}`);
const one = (x: number | null) => (x == null ? "-" : (Math.round(x * 10) / 10).toString());
const lastLine = (x: number | null) => (x == null ? "nothing last week" : `${one(x)} last week`);

// this week's target sign: the chosen one while it is still there, else none
const target = computed(() => {
  const id = settings.value.week?.sign;
  const e = id ? (j.elements.data.value ?? []).find((x) => x.id === id && !x.deletedAt) : undefined;
  return e ? { id: e.id, name: e.name ?? "" } : null;
});
const isTarget = computed(() => !!w.value.topSign && target.value?.id === w.value.topSign.id);
const setTarget = (id: string) => void saveSettings({ week: { sign: id } });

const row = computed(() => (log.data.value ?? []).find((r) => r.date === today.value && r.item === WEEK_REVIEW_HABIT && r.done));
const done = useChange(async () => {
  await tickPractice(WEEK_REVIEW_HABIT, today.value, true, row.value);
  goBack(router, "/train");
}, ["practice"]);
</script>

<template>
  <div class="tview wrev">
    <div class="ph"><div><button type="button" class="back" @click="goBack(router, '/train')"><Icon name="left" :size="16" /><span>{{ back }}</span></button><h1>Weekly review</h1><div class="sub num">{{ range }}</div></div><div class="acts"><button class="btn s keep" :disabled="done.busy.value" @click="done.run()">Done</button></div></div>

    <div class="grid g2 wrev-tiles">
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="moon" :size="15" /></span>Dreams a night</div><div class="val num">{{ one(w.now.recall) }}</div><div class="sub">{{ lastLine(w.last.recall) }}</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="sparkle" :size="15" /></span>Lucid dreams</div><div class="val num">{{ w.now.lucid }}</div><div class="sub">{{ w.last.lucid }} last week</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="check" :size="15" /></span>Checks a day</div><div class="val num">{{ one(w.now.checksPerDay) }}</div><div class="sub">{{ lastLine(w.last.checks ? w.last.checksPerDay : null) }}</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="calendar" :size="15" /></span>Nights logged</div><div class="val num">{{ w.now.nights }}<small>of 7</small></div><div class="sub">{{ w.last.nights }} last week</div></div>
    </div>

    <section>
      <div class="sh"><h2>Your week</h2></div>
      <div class="card">
        <p v-for="(n, i) in w.notes" :key="i" class="wrev-note">{{ n.text.replace(/ ?\[[A-Z]\d+\]/g, "") }} <CiteChips :ids="n.sources" @cite="open = $event" /></p>
        <template v-if="w.techniques.length">
          <div class="s tiny hrv">Techniques this week</div>
          <div v-for="tq in w.techniques" :key="tq.id" class="tiny num">{{ tq.label }} · {{ tq.nights }} {{ tq.nights === 1 ? "night" : "nights" }}<template v-if="tq.lucidNights"> · {{ tq.lucidNights }} lucid</template></div>
        </template>
      </div>
    </section>

    <section>
      <div class="sh"><h2>Next week</h2></div>
      <div class="card">
        <p class="wrev-note"><b>Try:</b> {{ w.tip.text.replace(/ ?\[[A-Z]\d+\]/g, "") }} <CiteChips :ids="w.tip.sources" @cite="open = $event" /></p>
        <div class="s tiny hrv">WBTB nights</div>
        <p class="tiny muted">The nights you can sleep in after. Tonight's plan suggests WBTB only on these, 3 a week at most and never two in a row. <CiteChips :ids="['B69', 'D1']" @cite="open = $event" /></p>
        <FreeNights />
        <div class="s tiny hrv">Target dream sign</div>
        <template v-if="w.topSign">
          <div class="t"><router-link :to="'/signs/' + w.topSign.id">{{ w.topSign.name }}</router-link> <span class="tiny muted num">· {{ w.topSign.dreams }} {{ w.topSign.dreams === 1 ? "dream" : "dreams" }} this week</span></div>
          <button v-if="!isTarget" type="button" class="qb acc" @click="setTarget(w.topSign.id)">Make it this week's target</button>
          <div v-else class="tiny muted">This week's target. Look out for it during the day and check whenever you meet it.</div>
        </template>
        <div v-else class="t">{{ target ? `Still ${target.name}: no marked sign came up this week.` : "None this week. Signs you mark in your dreams appear here." }}</div>
      </div>
    </section>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </div>
</template>

<style scoped>
.wrev > section, .wrev-tiles { margin-top: var(--spg); }
.wrev-note { margin: 0 0 var(--tdy); }
.wrev .qb { margin-top: var(--tdy); }
</style>
