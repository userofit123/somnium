<script setup lang="ts">
// Insights (PLAN.md §6.5, LDJ-21 and LDJ-22): recall, lucidity, what goes with lucid nights, reality checks, night
// events and the Learn questionnaire answers over a chosen period. Everything is summed here on the device from the
// journal it already holds (packages/shared/src/insights.ts); nothing is sent anywhere. A lazy route, so the
// charts load with this page only. No primary action: it only shows. Computer: a two-column grid; phone: one.
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  PERIODS, PERIOD_LABEL, periodStart, bucketFor, bucketOf, recallInsight, lucidityInsight, eventsInsight, emotionsInsight,
  checksInsight, whatWorks, pmWeek, localClock, EMOTION_ANCHORS, MIN_NIGHTS, type Period, type Bucket, type Comparison, type RealityCheck,
} from "@somnium/shared";
import { assessments, assessmentIds, optionFor } from "@somnium/knowledge/assessments";
import { useJournal } from "../api/journal";
import { api } from "../api/client";
import { useHabitLog } from "../api/train";
import { loaded } from "../api/queries";
import { useLearn } from "../core/learn";
import { useToday } from "../core/today";
import { readJson, writeJson } from "../core/prefs";
import BarChart from "../components/BarChart.vue";
import GoalCards from "../components/goals/GoalCards.vue";
import LagCard from "../components/insights/LagCard.vue";
import ThemesCard from "../components/insights/ThemesCard.vue";
import { useSettings } from "../api/queries";
import LineChart from "../components/LineChart.vue";
import "../styles/components/insights.css";

const j = useJournal();
const today = useToday();
const settings = useSettings();
const features = computed(() => settings.value.features);
const PREF = "insights.period";
const period = ref<Period>((PERIODS as readonly string[]).includes(readJson<string>(PREF, "3m")) ? readJson<Period>(PREF, "3m") : "3m");
const setPeriod = (p: Period) => { period.value = p; writeJson(PREF, p); };
const from = computed(() => periodStart(period.value, today.value));
const bucket = computed<Bucket>(() => bucketFor(period.value));
// every check of the period (all=1: no limit, so a long habit of checks is never cut short)
const habitLog = useHabitLog();
const checksQ = useQuery({
  queryKey: computed(() => ["checks", "insights", from.value ?? "all"]),
  queryFn: () => api.get<RealityCheck[]>("/reality-checks", { ...(from.value ? { from: new Date(from.value + "T00:00:00").toISOString() } : {}), all: 1 }),
});
// every night (all=1) and every dream's plain facts (no limit): no sum here stops at an older dream
await loaded(j.nights, j.facts);
const { answers } = useLearn();

const nights = computed(() => j.nights.data.value ?? []);
const dreams = computed(() => j.facts.data.value ?? []);
const recall = computed(() => recallInsight(nights.value, dreams.value, from.value, today.value, bucket.value));
const lucid = computed(() => lucidityInsight(nights.value, dreams.value, from.value, today.value, bucket.value));
const events = computed(() => eventsInsight(nights.value, dreams.value, from.value, today.value, bucket.value));
const emotions = computed(() => emotionsInsight(nights.value, dreams.value, from.value, today.value, bucket.value));
const checks = computed(() => checksInsight(checksQ.data.value ?? [], from.value, today.value, localClock));
// memory targets (LDJ-50): the last 7 days, whatever period is chosen above
const pm = computed(() => pmWeek(habitLog.data.value ?? [], today.value));
const works = computed(() => {
  const inPeriod = nights.value.filter((n) => (from.value == null || n.date >= from.value) && n.date <= today.value);
  return whatWorks(inPeriod, dreams.value, localClock);
});

// ---------- labels ----------
const mon = (ymd: string, o: Intl.DateTimeFormatOptions) => new Date(ymd.length === 7 ? ymd + "-01T12:00:00" : ymd + "T12:00:00").toLocaleDateString(undefined, o);
const bucketLabel = (key: string) => (key.length === 7 ? mon(key, { month: "short" }) : mon(key, { day: "numeric", month: "short" }));
const pct = (v: number) => `${Math.round(v * 100)}%`;
const one = (v: number) => (Math.round(v * 10) / 10).toString();
const plural = (n: number, w: string, ws = w + "s") => `${n} ${n === 1 ? w : ws}`;
const HOW: Record<string, string> = { dream_sign: "Dream sign", reality_check: "Reality check", wild: "WILD", spontaneous: "On its own", nightmare: "Nightmare", other: "Other", unknown: "Not noted" };
const KIND: Record<string, string> = { nose: "Nose pinch", hands: "Hands", text: "Text", clock: "Clock", light: "Light switch", jump: "Jump", finger_palm: "Finger through palm", other: "Other" };

// ---------- recall ----------
const recallBars = computed(() => recall.value.byBucket.map((r) => ({ label: bucketLabel(r.key), value: r.nights ? r.dreams / r.nights : 0, dim: !r.nights })));
const weekdayBars = computed(() => recall.value.byWeekday.map((r) => ({ label: r.key, value: r.nights ? r.withRecall / r.nights : 0, dim: !r.nights })));

// ---------- lucidity ----------
const lucidBars = computed(() => lucid.value.byBucket.map((r) => ({ label: bucketLabel(r.key), value: r.lucid, color: "var(--acc2)" })));
const levelBars = computed(() => lucid.value.levels.map((n, i) => ({ label: i ? String(i) : "None", value: n, color: "var(--acc2)" })).filter((b, i) => i > 0 || b.value > 0));
const howBars = computed(() => lucid.value.how.map((h) => ({ label: HOW[h.how] ?? h.how, value: h.count, color: "var(--acc2)" })));

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
const sourceBars = computed(() => [{ label: "Reminder", value: checks.value.prompted, color: "var(--c3)" }, { label: "My own", value: checks.value.own, color: "var(--c3)" }]);

// ---------- night events ----------
const eventSets = computed(() => [
  { title: "Nightmares", total: events.value.total.nightmares, color: "var(--c1)", bars: events.value.byBucket.map((r) => ({ label: bucketLabel(r.key), value: r.nightmares, color: "var(--c1)" })) },
  { title: "False awakenings", total: events.value.total.falseAwakenings, color: "var(--c2)", bars: events.value.byBucket.map((r) => ({ label: bucketLabel(r.key), value: r.falseAwakenings, color: "var(--c2)" })) },
  { title: "Sleep paralysis", total: events.value.total.sleepParalysis, color: "var(--c5)", bars: events.value.byBucket.map((r) => ({ label: bucketLabel(r.key), value: r.sleepParalysis, color: "var(--c5)" })) },
]);
const emotionPoints = computed(() => emotions.value.byBucket.filter((r) => r.avg != null).map((r) => ({ x: Date.parse(r.key.length === 7 ? r.key + "-01" : r.key), y: r.avg!, label: `${bucketLabel(r.key)} · ${plural(r.rated, "dream")}` })));
// numbers on the axis (the anchor words don't fit beside it); the tooltip's label names the period
const feel = (v: number) => (v > 0 ? "+" : "") + one(v);

// ---------- your answers ----------
const answerSets = computed(() => assessmentIds.map((id) => {
  const list = answers.value?.[id] ?? [];
  const last = list.at(-1);
  return {
    id, a: assessments[id], count: list.length, last, lastLabel: last ? optionFor(id, last.value)?.label ?? "" : "",
    points: list.map((x) => ({ x: Date.parse(x.date), y: optionFor(id, x.value)?.rate ?? 0, label: `${optionFor(id, x.value)?.label ?? ""} · ${mon(x.date, { day: "numeric", month: "short", year: "numeric" })}` })),
  };
}).filter((s) => s.count));
const dateLong = (ymd: string) => mon(ymd, { day: "numeric", month: "long", year: "numeric" });
</script>

<template>
  <div class="page insights">
    <div class="ph"><div><h1>Insights</h1><div class="sub">Worked out on this device from your journal.</div></div><router-link v-if="features.reports" to="/report" class="lnk" data-testid="reportlink">Month and year reports</router-link></div>
    <div class="seg ins-period" role="tablist" aria-label="Period">
      <button v-for="p in PERIODS" :key="p" type="button" role="tab" :class="{ on: period === p }" :aria-selected="period === p" @click="setPeriod(p)">{{ PERIOD_LABEL[p] }}</button>
    </div>

    <div class="grid g2 ins-grid">
      <GoalCards v-if="features.goals" :today="today" />
      <LagCard v-if="features.dayNotes" :today="today" />
      <ThemesCard v-if="features.typicalThemes" />
      <!-- Recall -->
      <section>
        <div class="sh"><h2>Recall</h2></div>
        <div class="card">
          <div v-if="!recall.nights" class="empty sm"><b>No nights logged in this period</b>Write down your dreams each morning, or mark "No recall", to see how often you remember them.</div>
          <template v-else>
            <div class="ins-stats">
              <div><div class="v num">{{ pct(recall.withRecall / recall.nights) }}</div><div class="tiny">nights with a dream</div></div>
              <div><div class="v num">{{ one(recall.dreams / recall.nights) }}</div><div class="tiny">dreams a night</div></div>
              <div><div class="v num">{{ recall.nights }}</div><div class="tiny">nights logged</div></div>
            </div>
            <div v-if="recall.napDreams" class="tiny ins-note">Naps aren't counted as nights here; their {{ plural(recall.napDreams, "dream") }} count with your dreams below.</div>
            <div class="ins-sub">Dreams a night, by {{ bucket }}</div>
            <BarChart :bars="recallBars" :fmt="one" :height="150" />
            <div class="ins-sub">Nights with a dream, by weekday</div>
            <BarChart :bars="weekdayBars" :fmt="pct" :height="130" />
          </template>
        </div>
      </section>

      <!-- Lucidity -->
      <section>
        <div class="sh"><h2>Lucidity</h2></div>
        <div class="card">
          <div v-if="!lucid.lucid" class="empty sm"><b>No lucid dreams in this period</b>When you mark a dream as lucid, with its level and how you knew, it shows here.</div>
          <template v-else>
            <div class="ins-stats">
              <div><div class="v num">{{ lucid.lucid }}</div><div class="tiny">lucid {{ lucid.lucid === 1 ? "dream" : "dreams" }}</div></div>
              <div><div class="v num">{{ pct(lucid.lucidNights / Math.max(1, lucid.nights)) }}</div><div class="tiny">nights with one</div></div>
              <div><div class="v num">{{ pct(lucid.lucid / Math.max(1, lucid.dreams)) }}</div><div class="tiny">of all dreams</div></div>
            </div>
            <div class="ins-sub">Lucid dreams, by {{ bucket }}</div>
            <BarChart :bars="lucidBars" :height="140" />
            <div class="ins-sub">How lucid (level 1-5)</div>
            <BarChart :bars="levelBars" :height="120" />
            <div class="ins-sub">How it started</div>
            <BarChart :bars="howBars" horizontal />
          </template>
        </div>
      </section>

      <!-- What works for you -->
      <section class="ins-wide">
        <div class="sh"><h2>What works for you</h2></div>
        <div class="card">
          <div v-if="!groups.length" class="empty sm"><b>Nothing to compare yet</b>Log your nights with the techniques you did, how long you took to fall asleep after them, WBTB and its minutes awake, and your bed and wake times. After {{ MIN_NIGHTS }} nights with and {{ MIN_NIGHTS }} without something, its lucid rate shows here.</div>
          <template v-else>
            <p class="tiny ins-note">What went with your lucid nights, from your own nights only: it shows what went together, not what caused what. A rate shows once there are {{ MIN_NIGHTS }} nights on each side.</p>
            <div class="ins-works">
              <div v-for="g in groups" :key="g.title" class="ins-wg">
                <div class="ins-sub">{{ g.title }}</div>
                <div v-for="c in g.rows" :key="c.id" class="ins-cmp" :data-id="c.id" :class="{ few: !c.enough }">
                  <div class="t">{{ c.label }}</div>
                  <div v-if="c.enough" class="ins-pair">
                    <div class="row"><span class="tiny">With</span><div class="pbar grow"><i :style="{ width: c.with.rate! * 100 + '%' }" /></div><span class="num tiny">{{ pct(c.with.rate!) }}</span></div>
                    <div class="row"><span class="tiny">Without</span><div class="pbar grow off"><i :style="{ width: c.without.rate! * 100 + '%' }" /></div><span class="num tiny">{{ pct(c.without.rate!) }}</span></div>
                  </div>
                  <div class="tiny s">{{ c.text }}</div>
                </div>
              </div>
            </div>
            <p v-if="!anyEnough" class="tiny ins-note">Not enough nights yet for any rate: keep logging.</p>
          </template>
        </div>
      </section>

      <!-- Checks -->
      <section>
        <div class="sh"><h2>Checks</h2></div>
        <div class="card">
          <div v-if="!checks.total" class="empty sm"><b>No reality checks in this period</b>Log a check from Train or a reminder each time you do one, and whether it said you were awake or dreaming.</div>
          <template v-else>
            <div class="ins-stats">
              <div><div class="v num">{{ one(checks.perDayAvg) }}</div><div class="tiny">a day</div></div>
              <div><div class="v num">{{ checks.total }}</div><div class="tiny">checks</div></div>
              <div><div class="v num">{{ checks.byOutcome.dreaming }}</div><div class="tiny">said "dreaming"</div></div>
            </div>
            <div class="ins-sub">Checks a day{{ period === "4w" ? "" : ", weekly average" }}</div>
            <BarChart :bars="checkBars" :fmt="one" :height="130" />
            <div class="ins-sub">By kind</div>
            <BarChart :bars="kindBars" horizontal />
            <div class="ins-sub">Reminder or your own</div>
            <BarChart :bars="sourceBars" horizontal />
            <p class="tiny ins-note">
              <template v-if="checks.byOutcome.dreaming">{{ plural(checks.byOutcome.dreaming, "check") }} said you were dreaming: lucid moments.</template>
              <template v-else>No check said "dreaming" yet.</template>
              {{ checks.byOutcome.unsure ? ` ${checks.byOutcome.unsure} unsure.` : "" }}
            </p>
          </template>
        </div>
      </section>

      <section v-if="pm.set">
        <div class="sh"><h2>Memory targets</h2></div>
        <div class="card">
          <div class="ins-stats">
            <div><div class="v num">{{ pm.rate == null ? "-" : pct(pm.rate) }}</div><div class="tiny">hit rate, last 7 days</div></div>
            <div><div class="v num">{{ pm.hit }} of {{ pm.hit + pm.miss }}</div><div class="tiny">targets hit</div></div>
          </div>
          <p class="tiny ins-note">A target you set and never logged counts as a miss once its day is over (LaBerge's exercise: hit most of the four before moving on).</p>
        </div>
      </section>

      <!-- Night events -->
      <section>
        <div class="sh"><h2>Night events</h2></div>
        <div class="card">
          <div v-if="!lucid.dreams" class="empty sm"><b>No dreams in this period</b>Mark nightmares, false awakenings and sleep paralysis on your dreams, and how each felt, to follow them here.</div>
          <template v-else>
            <div class="ins-stats">
              <div v-for="e in eventSets" :key="e.title"><div class="v num" :style="{ color: e.color }">{{ e.total }}</div><div class="tiny">{{ e.title.toLowerCase() }}</div></div>
            </div>
            <template v-for="e in eventSets" :key="e.title">
              <template v-if="e.total">
                <div class="ins-sub">{{ e.title }}, by {{ bucket }}</div>
                <BarChart :bars="e.bars" :height="100" />
              </template>
            </template>
            <div class="ins-sub">How your dreams felt</div>
            <div v-if="emotionPoints.length < 2" class="tiny ins-note">{{ emotions.rated ? "Rate the feeling of dreams across more than one " + bucket + " to see a trend." : "Rate how each dream felt to see it over time." }}</div>
            <template v-else>
              <LineChart :points="emotionPoints" :fmt="feel" :height="150" color="var(--c3)" />
              <div class="tiny">Average feeling, from -2 ({{ EMOTION_ANCHORS[0].toLowerCase() }}) to +2 ({{ EMOTION_ANCHORS[4].toLowerCase() }}).</div>
            </template>
          </template>
        </div>
      </section>

      <!-- Your answers -->
      <section>
        <div class="sh"><h2>Your answers</h2></div>
        <div class="card">
          <div v-if="!answerSets.length" class="empty sm"><b>No answers yet</b>Answer the two questions in <router-link to="/learn/where-am-i" class="lnk inl">Learn · Where am I</router-link> now and again to see how they change.</div>
          <template v-else>
            <p class="tiny ins-note">All your answers, whatever the period.</p>
            <div v-for="s in answerSets" :key="s.id" class="ins-ans">
              <div class="ins-sub">{{ s.a.title }}</div>
              <div class="tiny">Last: <b>{{ s.lastLabel }}</b> · {{ dateLong(s.last!.date) }} · {{ plural(s.count, "answer") }}</div>
              <LineChart v-if="s.points.length > 1" :points="s.points" :fmt="(v: number) => one(v)" :height="120" zero />
              <div v-if="s.points.length > 1" class="tiny">Counted as {{ s.a.unit }}.</div>
            </div>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>
