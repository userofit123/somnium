<script setup lang="ts">
// Home (PLAN.md §6.1, LDJ-33): this morning, today, tonight, streaks and rates, and the optional cards. On a computer
// two columns (the day on the left, the night and the numbers on the right); on a phone one column in that order.
// Only titles of dreams appear here, never their text. Which night is which, the summary and the progress strings
// are pure (packages/shared/src/home.ts); the course texts and Learn's articles load with this page only.
import { computed, onUnmounted, ref, watch } from "vue";
import { currentLesson, elementStats, frequencyText, signShortlist, homeNights, homeRates, morningState, nextReminder, checksOn, lastLucid, planDay, rcSchedule, tipIndex } from "@somnium/shared";
import { useJournal } from "../api/journal";
import { loadSignLexicons, signLexicons } from "../api/signs";
import { useTrain, tonightNight } from "../api/train";
import { loaded, useSettings } from "../api/queries";
import { useQuery } from "@tanstack/vue-query";
import { REMINDERS_KEY, fetchReminders, rcRow } from "../native/reminders";
import { localYmd } from "../core/format";
import { useToday } from "../core/today";
import "../styles/components/train.css";
import "../styles/components/home.css";
import MorningCard from "../components/home/MorningCard.vue";
import TodayCard from "../components/home/TodayCard.vue";
import TonightCard from "../components/home/TonightCard.vue";
import RatesCard from "../components/home/RatesCard.vue";
import ExtraCards from "../components/home/ExtraCards.vue";
import ForYouCard from "../components/ForYouCard.vue";
import { isPhone } from "../core/device";

const j = useJournal();
const t = useTrain();
const reminders = useQuery({ queryKey: [...REMINDERS_KEY], queryFn: fetchReminders, staleTime: 60_000 });
const settings = useSettings();
// the texts load while the queries run, not before them
const [{ articles }, { lessons, findLesson, practiceItemId }, { findTechnique }] = await Promise.all([
  import("@somnium/knowledge/content"), import("@somnium/knowledge/course"), import("@somnium/knowledge/techniques"),
  loaded(j.nights, j.dreams, t.course, t.practice, t.checks, reminders),
]);

// reactive: the page can stay open across midnight
const today = useToday();
// the clock moves on while the page is open (the next reminder, the 05:00 turn): a minute's tick is enough here
const now = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 60_000);
onUnmounted(() => clearInterval(clock));
const when = computed(() => homeNights(today.value, new Date(now.value).getHours()));
const nights = computed(() => j.nights.data.value ?? []);
const dreams = computed(() => j.dreams.data.value ?? []);

const morning = computed(() => morningState(nights.value, dreams.value, when.value.lastNight));

// reality checks: done today against the plan for today, 0 planned while reminders are off
const row = computed(() => rcRow(reminders.data.value));
const remindersOn = computed(() => !!row.value?.enabled);
const plan = computed(() => {
  if (!row.value?.enabled) return { today: 0, times: [] as number[] };
  const s = rcSchedule(row.value.schedule), sleep = settings.value.sleep;
  const days = [-1, 0, 1].map((d) => { const x = new Date(today.value + "T12:00:00"); x.setDate(x.getDate() + d); return localYmd(x); });
  return { today: planDay(s, today.value, s.seed, sleep).length, times: days.flatMap((d) => planDay(s, d, s.seed, sleep).map((p) => p.at)) };
});
const checksDone = computed(() => checksOn((t.checks.data.value ?? []).map((c) => localYmd(new Date(c.at))), today.value));
const next = computed(() => nextReminder(plan.value.times, now.value));

// today's course practice, the same items and ticks as Train's course card
const lesson = computed(() => { const id = currentLesson(t.course.data.value ?? []); return id ? findLesson(id) ?? null : null; });
const items = computed(() => (lesson.value?.practice ?? []).map((text, i) => {
  const id = practiceItemId(lesson.value!.id, i);
  return { id, text, row: (t.practice.data.value ?? []).find((p) => p.item === id && p.date === today.value && p.done) };
}));

// tonight
const tonight = computed(() => tonightNight(nights.value, when.value.tonight));
const titleOf = (id: string) => { const tq = findTechnique(id); return (tq && articles.find((a) => a.id === "techniques/" + tq.slug)?.title) ?? id.replace(/-/g, " "); };
const planned = computed(() => (tonight.value?.techniquesPlanned ?? []).map((id) => ({ id, title: titleOf(id) })));

const rates = computed(() => homeRates(nights.value, dreams.value, today.value));

// optional cards
const on = computed(() => settings.value.features);
const lessonCard = computed(() => (on.value.homeLesson && lesson.value ? { id: lesson.value.id, number: lesson.value.number, of: lessons.length, title: lesson.value.title, summary: lesson.value.summary } : null));
const tip = computed(() => {
  if (!on.value.homeTip) return null;
  const pool = articles.filter((a) => a.summary);
  const a = pool[tipIndex(today.value, pool.length)];
  return a ? { id: a.id, title: a.title, summary: a.summary } : null;
});
watch(() => on.value.homeSigns, (v) => { if (v) void loadSignLexicons(); }, { immediate: true });
// top dream signs: the same shortlist as Signs, over every dream's facts (never the capped list)
const signs = computed(() => {
  if (!on.value.homeSigns) return null;
  const els = j.elements.data.value ?? [], facts = j.facts.data.value ?? [];
  const list = signShortlist(els, elementStats(els, j.links.data.value ?? [], facts, today.value), facts, signLexicons.value?.checks ?? [], today.value, 3);
  return list.map((x) => ({ id: x.element.id, name: x.element.name ?? "", line: [x.check ? `Check: ${x.check.name}` : "", frequencyText(x.frequency)].filter(Boolean).join(" · ") }));
});
const lucid = computed(() => {
  if (!on.value.homeLastLucid) return null;
  const d = lastLucid(dreams.value);
  return d ? { id: d.id, date: d.date, title: d.title?.trim() || "Untitled dream" } : null;
});
</script>

<template>
  <div class="page home">
    <div class="ph"><div><h1>Home</h1></div></div>
    <div class="grid g2 hgrid">
      <div class="hcol">
        <MorningCard :state="morning" :date="when.lastNight" />
        <ForYouCard v-if="isPhone" />
        <TodayCard :done="checksDone" :planned="plan.today" :next="next" :reminders-on="remindersOn" :today="today" :primary="morning.kind !== 'open'"
          :lesson="lesson ? { id: lesson.id, title: lesson.title } : null" :items="items" />
      </div>
      <div class="hcol">
        <ForYouCard v-if="!isPhone" />
        <TonightCard :date="when.tonight" :same="when.same" :planned="planned" :intention="tonight?.intention ?? ''" />
        <RatesCard :rates="rates" />
        <ExtraCards :lesson="lessonCard" :tip="tip" :lucid="lucid" :signs="signs" />
      </div>
    </div>
  </div>
</template>
