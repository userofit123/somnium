<script setup lang="ts">
// Month report and year in review (optional, LDJ-41): counts for one month or one year, summed on this device from the
// journal (packages/shared/src/report.ts). No dream text: element names, technique names and, for the best night, its
// title. "Print" uses the browser's print dialog; the print styles below leave only the report on the page.
import { computed, ref } from "vue";
import { monthName, periodSummary, reportPeriods, yearSummary } from "@somnium/shared";
import { useJournal, type NightRow } from "../api/journal";
import { loaded, useSettings } from "../api/queries";
import { useToday } from "../core/today";
import { useFmt } from "../core/format";

const j = useJournal();
const settings = useSettings();
await loaded(j.nights, j.dreams, j.elements, j.links);
const today = useToday();
const fmt = useFmt();
const nights = computed(() => (j.nights.data.value ?? []) as NightRow[]);
const periods = computed(() => reportPeriods(nights.value));
const mode = ref<"month" | "year">("month");
const month = ref(periods.value.months[0] ?? today.value.slice(0, 7));
const year = ref(periods.value.years[0] ?? today.value.slice(0, 4));
const input = computed(() => ({ nights: nights.value, dreams: j.dreams.data.value ?? [], elements: j.elements.data.value ?? [], links: j.links.data.value ?? [] }));
const s = computed(() => (mode.value === "month" ? periodSummary(month.value, input.value) : yearSummary(year.value, input.value)));
const ys = computed(() => (mode.value === "year" ? yearSummary(year.value, input.value) : null));
const title = computed(() => (mode.value === "month" ? monthName(month.value) : `Your year ${year.value}`));
const print = () => globalThis.print();
const pct = (x: number | null) => (x == null ? "-" : Math.round(x * 100) + "%");
</script>

<template>
  <div v-if="!settings.features.reports" class="page"><div class="card empty sm">Switch on "Month report and year in review" in Settings → Features to see this page.</div></div>
  <div v-else class="page report">
    <div class="ph noprint"><div><h1>Reports</h1><div class="sub">Worked out on this device. No dream text is used.</div></div>
      <button class="btn" type="button" @click="print">Print</button></div>
    <div class="row noprint rep-pick">
      <div class="seg" role="tablist"><button v-for="m in (['month', 'year'] as const)" :key="m" type="button" role="tab" :class="{ on: mode === m }" @click="mode = m">{{ m === "month" ? "Month" : "Year" }}</button></div>
      <select v-if="mode === 'month'" v-model="month" aria-label="Month"><option v-for="m in (periods.months.length ? periods.months : [month])" :key="m" :value="m">{{ monthName(m) }}</option></select>
      <select v-else v-model="year" aria-label="Year"><option v-for="y in (periods.years.length ? periods.years : [year])" :key="y" :value="y">{{ y }}</option></select>
    </div>

    <article class="rep-sheet" data-testid="report">
      <h2 class="rep-title">{{ title }}</h2>
      <div v-if="!s.nightsLogged && !s.dreams" class="card empty sm">Nothing logged in this {{ mode }}.</div>
      <template v-else>
        <div class="card ins-stats">
          <div><div class="v num">{{ s.dreams }}</div><div class="tiny">dreams</div></div>
          <div><div class="v num">{{ pct(s.recallRate) }}</div><div class="tiny">nights with a dream ({{ s.nightsWithRecall }} of {{ s.nightsLogged }})</div></div>
          <div><div class="v num">{{ s.lucid }}</div><div class="tiny">lucid dreams</div></div>
        </div>
        <div v-if="ys" class="card">
          <h3>By month</h3>
          <div v-for="m in ys.months.filter((x) => x.dreams)" :key="m.month" class="li"><div class="grow"><div class="t">{{ monthName(m.month).replace(" " + year, "") }}</div></div><div class="tiny num">{{ m.dreams }} dreams · {{ m.lucid }} lucid · {{ pct(m.recallRate) }} recall</div></div>
          <div v-if="ys.bestMonth" class="tiny">Most dreams: {{ monthName(ys.bestMonth) }}.</div>
        </div>
        <div class="card"><h3>Top dream signs</h3>
          <div v-if="!s.topSigns.length" class="tiny">No marked dream signs turned up in this {{ mode }}.</div>
          <div v-for="x in s.topSigns" :key="x.name" class="li"><div class="grow t">{{ x.name }}</div><div class="tiny num">{{ x.dreams }} {{ x.dreams === 1 ? "dream" : "dreams" }}</div></div></div>
        <div class="card"><h3>New elements</h3>
          <div v-if="!s.newElementCount" class="tiny">Nothing new appeared for the first time.</div>
          <div v-else class="tiny">{{ s.newElementCount }} first seen: {{ s.newElements.map((e) => e.name).join(", ") }}<template v-if="s.newElementCount > s.newElements.length">, and more</template></div></div>
        <div class="card"><h3>Techniques tried</h3>
          <div v-if="!s.techniques.length" class="tiny">None marked on a night.</div>
          <div v-for="x in s.techniques" :key="x.id" class="li"><div class="grow t">{{ x.label }}</div><div class="tiny num">{{ x.nights }} {{ x.nights === 1 ? "night" : "nights" }}</div></div></div>
        <div v-if="s.best" class="card"><h3>Best night</h3>
          <div class="t">{{ s.best.title || "Untitled dream" }}</div>
          <div class="tiny">{{ fmt.date(s.best.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) }}<template v-if="s.best.lucid"> · lucid<template v-if="s.best.lucidityLevel"> level {{ s.best.lucidityLevel }}</template></template></div></div>
      </template>
    </article>
  </div>
</template>

<style>
.rep-pick { gap: var(--s2, 8px); align-items: center; }
.rep-sheet { display: grid; gap: var(--spg, 16px); }
.rep-title { margin: 0; }
.report h3 { margin: 0 0 var(--s1, 4px); font-size: 14px; }
@media print {
  body * { visibility: hidden; }
  .report .rep-sheet, .report .rep-sheet * { visibility: visible; }
  .report .rep-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; color-scheme: light; color: CanvasText; background: Canvas; }
  .report .card { box-shadow: none; border: 1px solid GrayText; background: transparent; break-inside: avoid; color: inherit; }
  .report .tiny, .report .t, .report .v { color: inherit; }
  .noprint { display: none !important; }
}
</style>
