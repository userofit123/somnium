<script setup lang="ts">
// Month report and year in review (optional, LDJ-41): counts for one month or one year, summed on this device from the
// journal (packages/shared/src/report.ts). No dream text: element names, technique names and, for the best night, its
// title. "Print" uses the browser's print dialog; the print styles below leave only the report on the page.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { monthName, periodSummary, reportPeriods, yearSummary } from "@somnium/shared";
import { useJournal, uuidv7, type NightRow } from "../api/journal";
import { loaded, useSettings } from "../api/queries";
import { useToday } from "../core/today";
import { useFmt } from "../core/format";
import AppSelect from "../components/AppSelect.vue";
import Menu from "../components/Menu.vue";
import Icon from "../components/Icon.vue";
import { goBack, backLabel } from "../core/leave";

const j = useJournal();
const settings = useSettings();
// an optional feature: absent while off, even by its address
const router = useRouter();
// opened from Progress's menu: its Back pill returns there (or to Progress when opened directly)
const back = backLabel(router, "Progress");
watch(() => !settings.value.features.reports, (off) => { if (off) void router.replace("/progress"); }, { immediate: true });
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
// the picker lists only periods with nights, so an empty report is mostly an empty journal: offer the first dream
const write = () => router.push({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1" } });
// Print is rare, so it sits in the menu; the period picker is what the page is for
const menu = [{ label: "Print", icon: "download", run: print }];
const monthOpts = computed(() => (periods.value.months.length ? periods.value.months : [month.value]).map((m) => ({ value: m, label: monthName(m) })));
const yearOpts = computed(() => (periods.value.years.length ? periods.value.years : [year.value]).map((y) => ({ value: y, label: y })));
const pct = (x: number | null) => (x == null ? "-" : Math.round(x * 100) + "%");
</script>

<template>
  <div v-if="settings.features.reports" class="page report">
    <div class="ph noprint"><div><button type="button" class="back" @click="goBack(router, '/progress')"><Icon name="left" :size="16" /><span>{{ back }}</span></button><h1>Reports</h1><div class="sub">Worked out on this device. No dream text is used.</div></div>
      <div class="acts">
        <div class="seg" role="tablist"><button v-for="m in (['month', 'year'] as const)" :key="m" type="button" role="tab" :aria-selected="mode === m" :class="{ on: mode === m }" @click="mode = m">{{ m === "month" ? "Month" : "Year" }}</button></div>
        <AppSelect v-if="mode === 'month'" v-model="month" :options="monthOpts" title="Month" style="width:auto" />
        <AppSelect v-else v-model="year" :options="yearOpts" title="Year" style="width:auto" />
        <Menu :items="menu" />
      </div></div>

    <article class="rep-sheet" data-testid="report">
      <h2 class="ttl">{{ title }}</h2>
      <div v-if="!s.nightsLogged && !s.dreams" class="card empty"><Icon name="stats" :size="34" /><b>Nothing logged in this {{ mode }}</b>Each night you log, with a dream or with No recall, is counted here.<br /><button class="btn tonal noprint" type="button" @click="write">Write a dream</button></div>
      <template v-else>
        <div class="grid g3 keep">
          <div class="card hero stat"><div class="lbl"><span class="bi"><Icon name="moon" :size="15" /></span>Dreams</div><div class="val num">{{ s.dreams }}</div><div class="sub">{{ s.nightsLogged }} nights logged</div></div>
          <div class="card stat"><div class="lbl"><span class="bi"><Icon name="calendar" :size="15" /></span>Nights with a dream</div><div class="val num">{{ pct(s.recallRate) }}</div><div class="sub">{{ s.nightsWithRecall }} of {{ s.nightsLogged }}</div></div>
          <div class="card stat"><div class="lbl"><span class="bi"><Icon name="sparkle" :size="15" /></span>Lucid dreams</div><div class="val num">{{ s.lucid }}</div><div class="sub">{{ s.dreams ? pct(s.lucid / s.dreams) + " of dreams" : "none yet" }}</div></div>
        </div>
        <div v-if="ys" class="card">
          <div class="lbl">By month</div>
          <div v-for="m in ys.months.filter((x) => x.dreams)" :key="m.month" class="li"><div class="grow"><div class="t">{{ monthName(m.month).replace(" " + year, "") }}</div></div><div class="tiny num">{{ m.dreams }} dreams · {{ m.lucid }} lucid · {{ pct(m.recallRate) }} recall</div></div>
          <div v-if="ys.bestMonth" class="tiny">Most dreams: {{ monthName(ys.bestMonth) }}.</div>
        </div>
        <div class="card"><div class="lbl">Top dream signs</div>
          <div v-if="!s.topSigns.length" class="empty sm">No marked dream signs turned up in this {{ mode }}.</div>
          <div v-for="x in s.topSigns" :key="x.name" class="li"><div class="grow t">{{ x.name }}</div><div class="tiny num">{{ x.dreams }} {{ x.dreams === 1 ? "dream" : "dreams" }}</div></div></div>
        <div class="card"><div class="lbl">New elements</div>
          <div v-if="!s.newElementCount" class="empty sm">Nothing new appeared for the first time.</div>
          <div v-else class="tiny">{{ s.newElementCount }} first seen: {{ s.newElements.map((e) => e.name).join(", ") }}<template v-if="s.newElementCount > s.newElements.length">, and more</template></div></div>
        <div class="card"><div class="lbl">Techniques tried</div>
          <div v-if="!s.techniques.length" class="empty sm">None marked on a night.</div>
          <div v-for="x in s.techniques" :key="x.id" class="li"><div class="grow t">{{ x.label }}</div><div class="tiny num">{{ x.nights }} {{ x.nights === 1 ? "night" : "nights" }}</div></div></div>
        <div v-if="s.best" class="card"><div class="lbl">Best night</div>
          <div class="t">{{ s.best.title || "Untitled dream" }}</div>
          <div class="tiny">{{ fmt.date(s.best.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) }}<template v-if="s.best.lucid"> · lucid<template v-if="s.best.lucidityLevel"> level {{ s.best.lucidityLevel }}</template></template></div></div>
      </template>
    </article>
  </div>
</template>

<style>
/* spacing from the density tokens and --spg between blocks, sizes from the type scale */
.rep-sheet { display: grid; gap: var(--spg); }
.report .card > .lbl { margin-bottom: var(--lpy); }
/* Print uses the system colours (CanvasText, Canvas, GrayText) on purpose, not the theme's: paper is light whatever the
   theme on screen, and these are the printer's own black on white. */
@media print {
  body * { visibility: hidden; }
  .report .rep-sheet, .report .rep-sheet * { visibility: visible; }
  .report .rep-sheet { position: absolute; inset: 0 auto auto 0; width: 100%; color-scheme: light; color: CanvasText; background: Canvas; }
  .report .card { box-shadow: none; border: 1px solid GrayText; background: transparent; break-inside: avoid; color: inherit; }
  .report .tiny, .report .t, .report .val, .report .lbl, .report .sub { color: inherit; }
  .noprint { display: none !important; }
}
</style>
