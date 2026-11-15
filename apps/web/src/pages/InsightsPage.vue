<script setup lang="ts">
// Progress (PLAN.md §6.5, LDJ-21, LDJ-22, LDJ-90): goals, lucidity, what goes with lucid nights, recall, reality checks,
// night events, day-note lag and the Learn questionnaire answers over a chosen period, in §6.5's order. Each section is
// a row of stat tiles and then one chart per card (Motus StatsPage), so it scans and the cards line up; the longer
// explanations sit behind each section's info button. Everything is summed here on the device from the journal it
// already holds (packages/shared/src/insights.ts); nothing is sent anywhere. A lazy route, so the charts load with
// this page only. No primary action: it only shows; the reports are in the ⋮ menu.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import {
  PERIODS, PERIOD_LABEL, BECAME_LUCID_LABEL, periodStart, bucketFor, bucketOf, recallInsight, recallProgress, recallChangeText,
  RECALL_TARGETS, RECALL_MIN_NIGHTS, RECALL_WINDOW, RECALL_COUNTING_SOURCES, RECALL_TARGET_SOURCES, RECALL_WHY_SOURCES, RECALL_FIRST_SOURCES, lucidityInsight, eventsInsight, emotionsInsight,
  checksInsight, checksBySign, SIGN_ADVICE_SOURCES, whatWorks, lucidRecipes, techniqueTally, EARLY_SOURCES, pmWeek, localClock, EMOTION_ANCHORS, MIN_NIGHTS, UPSET_HINT, UPSET_SOURCES, type Period, type Bucket, type Comparison, type RealityCheck, type TechniqueTally,
} from "@somnium/shared";
import { assessments, assessmentIds, optionFor } from "@somnium/knowledge/assessments";
import { useJournal } from "../api/journal";
import { api } from "../api/client";
import { useHabitLog } from "../api/train";
import { loaded, useSettings } from "../api/queries";
import { useLearn } from "../core/learn";
import { useToday } from "../core/today";
import { readJson, writeJson } from "../core/prefs";
import AppSelect from "../components/AppSelect.vue";
import BarChart from "../components/BarChart.vue";
import Icon from "../components/Icon.vue";
import LineChart from "../components/LineChart.vue";
import Menu from "../components/Menu.vue";
import ProgressBar from "../components/ProgressBar.vue";
import Sheet from "../components/Sheet.vue";
import GoalCards from "../components/goals/GoalCards.vue";
import LagCard from "../components/insights/LagCard.vue";
import ThemesCard from "../components/insights/ThemesCard.vue";
import SourceSheet from "../components/learn/SourceSheet.vue";
import CiteChips from "../components/learn/CiteChips.vue";
import "../styles/components/learn.css";
import "../styles/components/insights.css";

const j = useJournal();
const today = useToday();
const settings = useSettings();
const features = computed(() => settings.value.features);
const router = useRouter();
const PREF = "insights.period";
const period = ref<Period>((PERIODS as readonly string[]).includes(readJson<string>(PREF, "3m")) ? readJson<Period>(PREF, "3m") : "3m");
const periodPick = computed({ get: () => period.value, set: (p: Period) => { period.value = p; writeJson(PREF, p); } });
// short wording for a tile subtitle ("in 3 months" reads oddly)
const SINCE: Record<string, string> = { "4w": "last 4 weeks", "3m": "last 3 months", "1y": "last year", all: "all time" };
const periodOpts = PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }));
// the reports are rare and optional, so they sit in the ⋮ menu rather than beside the period
const menu = computed(() => (features.value.reports ? [{ label: "Month and year reports", icon: "stats", run: () => void router.push("/report") }] : []));
// which section's explanation is open: one Sheet at a time
const info = ref<"works" | "pm" | "events" | "recall" | null>(null);
const from = computed(() => periodStart(period.value, today.value));
const bucket = computed<Bucket>(() => bucketFor(period.value));
// every check of the period (all=1: no limit, so a long habit of checks is never cut short)
const habitLog = useHabitLog();
const checksQ = useQuery({
  queryKey: computed(() => ["checks", "insights", from.value ?? "all"]),
  queryFn: () => api.get<RealityCheck[]>("/reality-checks", { ...(from.value ? { from: new Date(from.value + "T00:00:00").toISOString() } : {}), all: 1 }),
});
// every night (all=1) and every dream's plain facts (no limit): no sum here stops at an older dream
await loaded(j.nights, j.facts, j.elements, j.links);
const { answers } = useLearn();

const nights = computed(() => j.nights.data.value ?? []);
const dreams = computed(() => j.facts.data.value ?? []);
// since the start, whatever the period; the setup answer (LDJ-180) will be passed here once setup stores one
const progress = computed(() => recallProgress(nights.value, dreams.value, today.value, null));
const recall = computed(() => recallInsight(nights.value, dreams.value, from.value, today.value, bucket.value));
const lucid = computed(() => lucidityInsight(nights.value, dreams.value, from.value, today.value, bucket.value));
const events = computed(() => eventsInsight(nights.value, dreams.value, from.value, today.value, bucket.value));
const emotions = computed(() => emotionsInsight(nights.value, dreams.value, from.value, today.value, bucket.value));
const checks = computed(() => checksInsight(checksQ.data.value ?? [], from.value, today.value, localClock));
// per paired dream sign (LDJ-200): the ids come from the checks; names only from the elements this device has decrypted,
// so a sign whose name is not readable is left out rather than shown by id
const signRows = computed(() => {
  const names = new Map((j.elements.data.value ?? []).map((e) => [e.id, e.name]));
  const inRange = dreams.value.filter((d) => (from.value == null || d.date >= from.value) && d.date <= today.value);
  const r = checksBySign(checksQ.data.value ?? [], j.links.data.value ?? [], inRange, from.value, today.value, localClock);
  return { rows: r.rows.flatMap((x) => (names.get(x.elementId) ? [{ ...x, name: names.get(x.elementId)! }] : [])), unpaired: r.unpaired };
});
const signLine = (r: { checks: number; lucidViaSign: number }) => `${plural(r.checks, "check")} · ${plural(r.lucidViaSign, "lucid dream")} from noticing it`;
// memory targets (LDJ-50): the last 7 days, whatever period is chosen above
const pm = computed(() => pmWeek(habitLog.data.value ?? [], today.value));
const inPeriod = computed(() => nights.value.filter((n) => (from.value == null || n.date >= from.value) && n.date <= today.value));
const works = computed(() => whatWorks(inPeriod.value, dreams.value, localClock));
// early results (LDJ-109): what each lucid night came after, and plain counts per technique before any rate shows
const recipes = computed(() => lucidRecipes(inPeriod.value, dreams.value, localClock));
const tally = computed(() => techniqueTally(inPeriod.value, dreams.value, localClock));

// ---------- labels ----------
const mon = (ymd: string, o: Intl.DateTimeFormatOptions) => new Date(ymd.length === 7 ? ymd + "-01T12:00:00" : ymd + "T12:00:00").toLocaleDateString(undefined, o);
// a chart's x from a morning or a month: local noon, so the axis never shows the day before west of UTC
const dayX = (ymd: string) => new Date((ymd.length === 7 ? ymd + "-01" : ymd) + "T12:00:00").getTime();
const bucketLabel = (key: string) => (key.length === 7 ? mon(key, { month: "short" }) : mon(key, { day: "numeric", month: "short" }));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const one = (v: number) => (Math.round(v * 10) / 10).toString();
const plural = (n: number, w: string, ws = w + "s") => `${n} ${n === 1 ? w : ws}`;
// the editor's own words (BECAME_LUCID_LABEL), so "spontaneous" reads the same everywhere
const HOW: Record<string, string> = { ...BECAME_LUCID_LABEL, unknown: "Not noted" };
const KIND: Record<string, string> = { nose: "Nose pinch", hands: "Hands", text: "Text", clock: "Clock", light: "Light switch", jump: "Jump", finger_palm: "Finger through palm", other: "Other" };

// ---------- recall ----------
const recallBars = computed(() => recall.value.byBucket.map((r) => ({ label: bucketLabel(r.key), value: r.nights ? r.dreams / r.nights : 0, dim: !r.nights })));
// recall progress (LDJ-113): weeks with a night logged, against the course's two targets
const progressPoints = computed(() => progress.value.weekly.filter((r) => r.nights).map((r) => ({ x: dayX(r.key), y: r.dreams / r.nights, label: `Week of ${bucketLabel(r.key)} · ${plural(r.nights, "night")}` })));
const recallMarks = [{ y: 1, label: "1 a night" }, { y: RECALL_TARGETS.perNight, label: `${RECALL_TARGETS.perNight} a night` }];
const progressLine = computed(() => recallChangeText(progress.value));
// "part of the rise is counting" only when there is a rise to explain
const progressRose = computed(() => !!progressLine.value && !!progress.value.base && (progress.value.now.perNight ?? 0) > progress.value.base.perNight);
const weekdayBars = computed(() => recall.value.byWeekday.map((r) => ({ label: r.key, value: r.nights ? r.withRecall / r.nights : 0, dim: !r.nights })));

// ---------- lucidity ----------
const lucidBars = computed(() => lucid.value.byBucket.map((r) => ({ label: bucketLabel(r.key), value: r.lucid, color: "var(--acc2)" })));
const levelBars = computed(() => lucid.value.levels.map((n, i) => ({ label: i ? String(i) : "None", value: n, color: "var(--acc2)" })).filter((b, i) => i > 0 || b.value > 0));
const howBars = computed(() => lucid.value.how.map((h) => ({ label: HOW[h.how] ?? h.how, value: h.count, color: "var(--acc2)" })));
// the average level of the lucid dreams that have one (levels[0] is "no level given")
const avgLevel = computed(() => {
  const ls = lucid.value.levels, n = ls.slice(1).reduce((a, b) => a + b, 0);
  return n ? one(ls.reduce((a, c, i) => a + c * i, 0) / n) : "-";
});

// ---------- what works ----------
const groups = computed(() => {
  const w = works.value, shown = (cs: Comparison[]) => cs.filter((c) => c.with.nights > 0);
  return [
    { title: "WBTB", rows: [w.wbtb].filter((c) => c.with.nights + c.without.nights > 0) },
    { title: "Minutes awake at WBTB", rows: shown(w.wbtbBands) },
    { title: "Techniques", rows: w.techniques },
    // shown once any technique or WBTB night is logged, so an empty count says to log the minutes to fall asleep
    { title: "Falling asleep after the technique", rows: w.techniques.length || w.wbtb.with.nights || w.asleep.with.nights + w.asleep.without.nights ? [w.asleep] : [] },
    { title: "Hours asleep", rows: shown(w.sleep) },
    { title: "Bedtime", rows: shown(w.bedtime) },
    { title: "Naps", rows: w.nap.with.nights ? [w.nap] : [] },
  ].filter((g) => g.rows.length);
});
const anyEnough = computed(() => groups.value.some((g) => g.rows.some((r) => r.enough)));
// the newest few lucid nights, the rest one tap away
const RECIPES_SHOWN = 5;
const allRecipes = ref(false);
const recipesShown = computed(() => (allRecipes.value ? recipes.value : recipes.value.slice(0, RECIPES_SHOWN)));
const anyEarly = computed(() => tally.value.some((t) => t.early));
// a technique's nights, opened from its count
const tallyOpen = ref<TechniqueTally | null>(null);
const nightLabel = (r: { date: string; nap: boolean }) => dateShort(r.date) + (r.nap ? " · nap" : "");

// ---------- checks ----------
// per day for 4 weeks; per week beyond, so a year isn't 365 hair-thin bars
const checkBars = computed(() => {
  const days = checks.value.perDay;
  if (period.value === "4w") return days.map((d) => ({ label: bucketLabel(d.key), value: d.count }));
  const by = new Map<string, number[]>();
  for (const d of days) { const k = bucketOf(d.key, "week"); by.set(k, [...(by.get(k) ?? []), d.count]); }
  return [...by].map(([k, v]) => ({ label: bucketLabel(k), value: v.reduce((a, b) => a + b, 0) / v.length }));
});
const kindBars = computed(() => checks.value.byKind.map((k) => ({ label: KIND[k.kind] ?? k.kind, value: k.count, color: "var(--c3)" })));

// ---------- night events ----------
const sourcesOpen = ref<string[] | null>(null);
const PM_SOURCES = ["D1"]; // RESEARCH.md 1.6, LaBerge and Rheingold 1990 ch. 3
const cite = (sid: string) => { info.value = null; sourcesOpen.value = [sid]; };
// nightmares (they woke you) apart from bad dreams (they didn't): RESEARCH.md C18
const eventSets = computed(() => [
  { title: "Nightmares", total: events.value.total.nightmares, color: "var(--c1)", bars: events.value.byBucket.map((r) => ({ label: bucketLabel(r.key), value: r.nightmares, color: "var(--c1)" })) },
  { title: "Bad dreams", total: events.value.total.badDreams, color: "var(--c6)", bars: events.value.byBucket.map((r) => ({ label: bucketLabel(r.key), value: r.badDreams, color: "var(--c6)" })) },
  { title: "False awakenings", total: events.value.total.falseAwakenings, color: "var(--c2)", bars: events.value.byBucket.map((r) => ({ label: bucketLabel(r.key), value: r.falseAwakenings, color: "var(--c2)" })) },
  { title: "Sleep paralysis", total: events.value.total.sleepParalysis, color: "var(--c5)", bars: events.value.byBucket.map((r) => ({ label: bucketLabel(r.key), value: r.sleepParalysis, color: "var(--c5)" })) },
]);
const emotionPoints = computed(() => emotions.value.byBucket.filter((r) => r.avg != null).map((r) => ({ x: dayX(r.key), y: r.avg!, label: `${bucketLabel(r.key)} · ${plural(r.rated, "dream")}` })));
// numbers on the axis (the anchor words don't fit beside it); the tooltip's label names the period
const feel = (v: number) => (v > 0 ? "+" : "") + one(v);

// ---------- your answers ----------
const answerSets = computed(() => assessmentIds.map((id) => {
  const list = answers.value?.[id] ?? [];
  const last = list.at(-1);
  return {
    id, a: assessments[id], count: list.length, last, lastLabel: last ? optionFor(id, last.value)?.label ?? "" : "",
    points: list.map((x) => ({ x: dayX(x.date), y: optionFor(id, x.value)?.rate ?? 0, label: `${optionFor(id, x.value)?.label ?? ""} · ${mon(x.date, { day: "numeric", month: "short", year: "numeric" })}` })),
  };
}).filter((s) => s.count));
const dateShort = (ymd: string) => mon(ymd, { day: "numeric", month: "short" });
const dateLong = (ymd: string) => mon(ymd, { day: "numeric", month: "long", year: "numeric" });
</script>

<template>
  <div class="page insights">
    <div class="ph"><div><h1>Progress</h1><div class="sub">Worked out on this device from your journal.</div></div>
      <div class="acts">
        <AppSelect v-model="periodPick" :options="periodOpts" title="Period" style="width:auto" data-testid="period" />
        <Menu v-if="menu.length" :items="menu" />
      </div></div>

    <GoalCards v-if="features.goals" :today="today" />

    <!-- Lucidity -->
    <section>
      <div class="sh"><h2>Lucidity</h2></div>
      <div v-if="!lucid.lucid" class="card empty sm"><b>No lucid dreams in this period</b>When you mark a dream as lucid, with its level and how you knew, it shows here.</div>
      <template v-else>
        <div class="grid g4">
          <div class="card hero stat"><div class="lbl">Lucid dreams</div><div class="val num">{{ lucid.lucid }}</div><div class="sub">{{ SINCE[period] }}</div></div>
          <div class="card stat"><div class="lbl">Nights with one</div><div class="val num">{{ pct(lucid.lucidNights / Math.max(1, lucid.nights)) }}</div><div class="sub">{{ lucid.lucidNights }} of {{ plural(lucid.nights, "night") }}</div></div>
          <div class="card stat"><div class="lbl">Of all dreams</div><div class="val num">{{ pct(lucid.lucid / Math.max(1, lucid.dreams)) }}</div><div class="sub">{{ plural(lucid.dreams, "dream") }}, all time</div></div>
          <div class="card stat"><div class="lbl">Average level</div><div class="val num">{{ avgLevel }}</div><div class="sub">from 1 to 5</div></div>
        </div>
        <div class="card spt"><div class="lbl hgap">Lucid dreams, by {{ bucket }}</div><BarChart :bars="lucidBars" :height="150" /></div>
        <div class="grid g2 spt">
          <div class="card"><div class="lbl hgap">How lucid (level 1-5)</div><BarChart :bars="levelBars" :height="140" /></div>
          <div class="card"><div class="lbl hgap">How it started</div><BarChart :bars="howBars" horizontal /></div>
        </div>
      </template>
    </section>

    <!-- What works for you -->
    <section>
      <div class="sh"><h2>What works for you</h2><button class="ib sm plain" type="button" aria-label="About these rates" @click="info = 'works'"><Icon name="info" :size="17" /></button></div>
      <div v-if="recipes.length || tally.length" class="grid g2" :class="{ 'ins-early': groups.length }" data-testid="early">
        <div v-if="recipes.length" class="card">
          <div class="lbl hgap">Your lucid dreams came after</div>
          <div class="list">
            <component :is="r.dreamId ? 'router-link' : 'div'" v-for="r in recipesShown" :key="r.id" :to="r.dreamId ? '/journal/dream/' + r.dreamId : undefined" class="li" :class="{ click: r.dreamId }">
              <div class="grow"><div class="t">{{ r.text }}</div><div class="tiny">{{ nightLabel(r) }}{{ r.lucid > 1 ? ` · ${r.lucid} lucid dreams` : "" }}</div></div>
            </component>
          </div>
          <button v-if="recipes.length > RECIPES_SHOWN" type="button" class="lnk inl tiny" @click="allRecipes = !allRecipes">{{ allRecipes ? "Show fewer" : `Show all ${recipes.length}` }}</button>
        </div>
        <div v-if="tally.length" class="card">
          <div class="lbl hgap">Techniques you tried</div>
          <div class="list">
            <button v-for="t in tally" :key="t.id" type="button" class="li click" :data-id="t.id" @click="tallyOpen = t">
              <div class="grow"><div class="t">{{ t.label }}</div><div class="tiny">{{ t.text }}</div></div>
              <span v-if="t.early" class="tag">early</span>
            </button>
          </div>
          <p v-if="anyEarly" class="tiny ins-note">Early numbers, not a rate yet: a few nights can go either way by chance, and even the best techniques gave a lucid dream on about 1 night in 6 in the largest study. A rate shows once there are {{ MIN_NIGHTS }} nights with and {{ MIN_NIGHTS }} without. <CiteChips :ids="EARLY_SOURCES" @cite="cite($event[0]!)" /></p>
        </div>
      </div>
      <div v-if="!groups.length" class="card empty sm"><b>Nothing to compare yet</b>Log your nights with the techniques you did, how long you took to fall asleep after them, WBTB and its minutes awake, and your bed and wake times. After {{ MIN_NIGHTS }} nights with and {{ MIN_NIGHTS }} without something, its lucid rate shows here.</div>
      <template v-else>
        <p v-if="!anyEnough" class="tiny">Not enough nights yet for any rate: keep logging.</p>
        <div class="grid g2">
          <div v-for="g in groups" :key="g.title" class="card">
            <div class="lbl hgap">{{ g.title }}</div>
            <div v-for="c in g.rows" :key="c.id" class="ins-cmp" :data-id="c.id" :class="{ few: !c.enough }">
              <div class="t">{{ c.label }}</div>
              <div v-if="c.enough" class="ins-pair">
                <div class="row"><span class="tiny">With</span><ProgressBar class="grow" :percent="c.with.rate! * 100" /><span class="num tiny">{{ pct(c.with.rate!) }}</span></div>
                <div class="row"><span class="tiny">Without</span><ProgressBar class="grow" muted :percent="c.without.rate! * 100" /><span class="num tiny">{{ pct(c.without.rate!) }}</span></div>
              </div>
              <div class="tiny s">{{ c.text }}</div>
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- Recall -->
    <section>
      <div class="sh"><h2>Recall</h2><button v-if="progress.weekly.length" class="ib sm plain" type="button" aria-label="About your recall progress" @click="info = 'recall'"><Icon name="info" :size="17" /></button></div>
      <template v-if="progress.weekly.length">
        <div class="grid" :class="progress.said ? 'g4' : 'g3 keep'">
          <div class="card hero stat" data-testid="recall-now"><div class="lbl">Dreams a night now</div><div class="val num">{{ progress.now.perNight == null ? "-" : one(progress.now.perNight) }}</div><div class="sub">{{ progress.now.nights ? `${plural(progress.now.nights, "night")} logged, last 2 weeks${progress.reached.twoANight ? ` · ${RECALL_TARGETS.perNight} a night reached` : ""}` : "no night logged in the last 2 weeks" }}</div></div>
          <div class="card stat"><div class="lbl">When you started</div><div class="val num">{{ progress.start?.perNight == null ? "-" : one(progress.start.perNight) }}</div><div class="sub">{{ progress.start ? `first ${plural(progress.start.nights, "night")} logged, from ${dateShort(progress.start.from)}` : `shows once ${RECALL_MIN_NIGHTS} nights are logged before the last 2 weeks` }}</div></div>
          <div v-if="progress.said" class="card stat"><div class="lbl">You said</div><div class="val num">{{ one(progress.said.perNight) }}</div><div class="sub">{{ progress.said.label }}</div></div>
          <div class="card stat"><div class="lbl">Nights in a row</div><div class="val num">{{ progress.run }}<small v-if="progress.run < RECALL_TARGETS.run">of {{ RECALL_TARGETS.run }}</small></div><div class="sub">{{ progress.reached.run ? `reached · best ${progress.bestRun}` : `with a dream · best ${progress.bestRun}` }}</div></div>
        </div>
        <div class="card spt"><div class="lbl hgap">Dreams a night, by week since you started</div>
          <div v-if="progressPoints.length < 2" class="tiny">Log a second week of mornings to see the trend.</div>
          <LineChart v-else :points="progressPoints" :fmt="one" :marks="recallMarks" :height="150" zero />
          <p class="tiny ins-note">{{ progressLine ? progressLine + ". " : "" }}{{ progressRose ? "Part of the rise is counting: a journal catches dreams you would forget, so keep going." : "Keep writing each morning: for most people a journal helps them remember more." }} <CiteChips :ids="RECALL_COUNTING_SOURCES" @cite="cite($event[0]!)" /></p>
        </div>
      </template>
      <div v-if="!recall.nights" class="card empty sm"><b>No nights logged in this period</b>Write down your dreams each morning, or mark "No recall", to see how often you remember them.</div>
      <template v-else>
        <div class="grid g4">
          <div class="card stat"><div class="lbl">Nights with a dream</div><div class="val num">{{ pct(recall.withRecall / recall.nights) }}</div><div class="sub">{{ recall.withRecall }} of {{ recall.nights }}</div></div>
          <div class="card stat"><div class="lbl">Dreams a night</div><div class="val num">{{ one(recall.dreams / recall.nights) }}</div><div class="sub">{{ plural(recall.dreams, "dream") }}, all time</div></div>
          <div class="card stat"><div class="lbl">Nights logged</div><div class="val num">{{ recall.nights }}</div><div class="sub">{{ SINCE[period] }}</div></div>
          <div class="card stat"><div class="lbl">Dreams in naps</div><div class="val num">{{ recall.napDreams }}</div><div class="sub">counted as dreams, not nights</div></div>
        </div>
        <div class="grid g2 spt">
          <div class="card"><div class="lbl hgap">Dreams a night, by {{ bucket }}, {{ SINCE[period] }}</div><BarChart :bars="recallBars" :fmt="one" :height="150" /></div>
          <div class="card"><div class="lbl hgap">Nights with a dream, by weekday</div><BarChart :bars="weekdayBars" :fmt="pct" :height="150" /></div>
        </div>
      </template>
    </section>

    <!-- Checks -->
    <section>
      <div class="sh"><h2>Checks</h2></div>
      <div v-if="!checks.total" class="card empty sm"><b>No reality checks in this period</b>Log a check from Home or Train · Today, or from a reminder, each time you do one, and whether it said you were awake or dreaming.</div>
      <template v-else>
        <div class="grid g4">
          <div class="card stat"><div class="lbl">A day</div><div class="val num">{{ one(checks.perDayAvg) }}</div><div class="sub">on average</div></div>
          <div class="card stat"><div class="lbl">Checks</div><div class="val num">{{ checks.total }}</div><div class="sub">{{ SINCE[period] }}</div></div>
          <div class="card stat"><div class="lbl">Said "dreaming"</div><div class="val num">{{ checks.byOutcome.dreaming }}</div><div class="sub">{{ checks.byOutcome.dreaming ? "lucid moments" : "none yet" }}{{ checks.byOutcome.unsure ? ` · ${checks.byOutcome.unsure} unsure` : "" }}</div></div>
          <div class="card stat"><div class="lbl">From a reminder</div><div class="val num">{{ pct(checks.prompted / checks.total) }}</div><div class="sub">{{ checks.own }} on your own</div></div>
        </div>
        <div class="grid g2 spt">
          <div class="card"><div class="lbl hgap">Checks a day{{ period === "4w" ? "" : ", weekly average" }}</div><BarChart :bars="checkBars" :fmt="one" :height="150" /></div>
          <div class="card"><div class="lbl hgap">By kind</div><BarChart :bars="kindBars" horizontal /></div>
        </div>
        <div v-if="signRows.rows.length" class="card spt" data-testid="checks-by-sign">
          <div class="lbl hgap">By dream sign</div>
          <ul class="ins-signs">
            <li v-for="r in signRows.rows" :key="r.elementId"><b>{{ r.name }}</b>: {{ signLine(r) }}{{ r.dreaming ? ` · ${r.dreaming} said "dreaming"` : "" }}</li>
          </ul>
          <p class="tiny ins-note">Checks you did when a reminder paired them with a sign{{ signRows.unpaired ? `; ${plural(signRows.unpaired, "other check")} had none` : "" }}. Counts, not a rate: noticing a sign you already know is the route dream sign training aims at. <CiteChips :ids="SIGN_ADVICE_SOURCES" @cite="cite($event[0]!)" /></p>
        </div>
      </template>
    </section>

    <section v-if="pm.set">
      <div class="sh"><h2>Memory targets</h2><button class="ib sm plain" type="button" aria-label="About memory targets" @click="info = 'pm'"><Icon name="info" :size="17" /></button></div>
      <div class="grid g2 keep">
        <div class="card stat"><div class="lbl">Hit rate</div><div class="val num">{{ pm.rate == null ? "-" : pct(pm.rate) }}</div><div class="sub">last 7 days</div></div>
        <div class="card stat"><div class="lbl">Targets hit</div><div class="val num">{{ pm.hit }}<small>of {{ pm.hit + pm.miss }}</small></div><div class="sub">last 7 days</div></div>
      </div>
    </section>

    <!-- Night events -->
    <section>
      <div class="sh"><h2>Night events</h2><button v-if="events.total.nightmares || events.total.badDreams" class="ib sm plain" type="button" aria-label="About nightmares and bad dreams" @click="info = 'events'"><Icon name="info" :size="17" /></button></div>
      <div v-if="!lucid.dreams" class="card empty sm"><b>No dreams in this period</b>Mark nightmares, bad dreams, false awakenings and sleep paralysis on your dreams, and how each felt, to follow them here.</div>
      <template v-else>
        <div class="grid g4">
          <div v-for="e in eventSets" :key="e.title" class="card stat"><div class="lbl">{{ e.title }}</div><div class="val num" :style="{ color: e.color }">{{ e.total }}</div><div class="sub">{{ SINCE[period] }}</div></div>
        </div>
        <div class="grid g2 spt">
          <template v-for="e in eventSets" :key="e.title">
            <div v-if="e.total" class="card"><div class="lbl hgap">{{ e.title }}, by {{ bucket }}</div><BarChart :bars="e.bars" :height="130" /></div>
          </template>
          <div class="card span2"><div class="lbl hgap">How your dreams felt</div>
            <div v-if="emotionPoints.length < 2" class="tiny">{{ emotions.rated ? "Rate the feeling of dreams across more than one " + bucket + " to see a trend." : "Rate how each dream felt to see it over time." }}</div>
            <template v-else>
              <LineChart :points="emotionPoints" :fmt="feel" :height="130" color="var(--c3)" />
              <div class="tiny">From -2 ({{ EMOTION_ANCHORS[0].toLowerCase() }}) to +2 ({{ EMOTION_ANCHORS[4].toLowerCase() }}).</div>
            </template>
          </div>
        </div>
      </template>
    </section>

    <ThemesCard v-if="features.typicalThemes" />
    <LagCard v-if="features.dayNotes" :today="today" />

    <!-- Your answers -->
    <section>
      <div class="sh"><h2>Your answers</h2></div>
      <div v-if="!answerSets.length" class="card empty sm"><b>No answers yet</b>Answer the two questions in <router-link to="/learn/where-am-i" class="lnk inl">Learn · Where am I</router-link> now and again to see how they change.</div>
      <template v-else>
        <p class="tiny">All your answers, whatever the period.</p>
        <div class="grid g2">
          <div v-for="s in answerSets" :key="s.id" class="card">
            <div class="lbl">{{ s.a.title }}</div>
            <div class="tiny hgap">Last: <b>{{ s.lastLabel }}</b> · {{ dateLong(s.last!.date) }} · {{ plural(s.count, "answer") }}</div>
            <template v-if="s.points.length > 1">
              <LineChart :points="s.points" :fmt="(v: number) => one(v)" :height="120" zero />
              <div class="tiny">Counted as {{ s.a.unit }}.</div>
            </template>
          </div>
        </div>
      </template>
    </section>

    <Sheet v-if="info === 'works'" title="What works for you" @close="info = null">
      <p>What went with your lucid nights, from your own nights only: it shows what went together, not what caused what.</p>
      <p>A rate shows once there are {{ MIN_NIGHTS }} nights on each side. The grey bar is the nights without it.</p>
      <p>Until then, what each lucid night came after and how many nights you tried each technique show as plain counts: early numbers, not a rate. <CiteChips :ids="EARLY_SOURCES" @cite="cite($event[0]!)" /></p>
    </Sheet>
    <Sheet v-if="tallyOpen" :title="tallyOpen.label" @close="tallyOpen = null">
      <p class="tiny">{{ tallyOpen.text }}, {{ SINCE[period] }}. The nights you did it, lucid or not: they show what went with your lucid nights, not what caused them.</p>
      <div class="list">
        <component :is="r.dreamId ? 'router-link' : 'div'" v-for="r in tallyOpen.list" :key="r.id" :to="r.dreamId ? '/journal/dream/' + r.dreamId : undefined" class="li" :class="{ click: r.dreamId }">
          <div class="grow"><div class="t">{{ nightLabel(r) }}</div><div class="tiny">{{ r.text }}</div></div>
          <span v-if="r.lucid" class="tag">Lucid</span>
        </component>
      </div>
    </Sheet>
    <Sheet v-if="info === 'recall'" title="Your recall" @close="info = null">
      <p>Dreams a night over the last two weeks, set against your first {{ RECALL_WINDOW }} logged nights, once each side has {{ RECALL_MIN_NIGHTS }} nights. In the international induction study, people with better dream recall had more success with the techniques <CiteChips :ids="RECALL_WHY_SOURCES" @cite="cite($event[0]!)" />; the course puts recall first <CiteChips :ids="RECALL_FIRST_SOURCES" @cite="cite($event[0]!)" />.</p>
      <p>The course's targets: a dream remembered every night for {{ RECALL_TARGETS.run }} nights in a row, then {{ RECALL_TARGETS.perNight }} a night. <CiteChips :ids="RECALL_TARGET_SOURCES" @cite="cite($event[0]!)" /></p>
      <p>Part of any rise is counting: writing dreams down each morning catches some you would have forgotten. For most people keeping a journal also helps them remember more, though in one study it raised recall in people who remembered few or some dreams and lowered it in those who already remembered many. <CiteChips :ids="RECALL_COUNTING_SOURCES" @cite="cite($event[0]!)" /></p>
    </Sheet>
    <Sheet v-if="info === 'pm'" title="Memory targets" @close="info = null">
      <p>A target you set and never logged counts as a miss once its day is over. LaBerge's exercise: keep going for at least a week, and if you still miss most targets, carry on until you hit most of them. <CiteChips :ids="PM_SOURCES" @cite="cite($event[0]!)" /></p>
    </Sheet>
    <Sheet v-if="info === 'events'" title="Nightmares and bad dreams" @close="info = null">
      <p>{{ UPSET_HINT }} <CiteChips :ids="UPSET_SOURCES" @cite="cite($event[0]!)" /></p>
    </Sheet>
    <SourceSheet v-if="sourcesOpen" :ids="sourcesOpen" @close="sourcesOpen = null" />
  </div>
</template>
