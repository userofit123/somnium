<script setup lang="ts">
// Home (PLAN.md §6.1, LDJ-33, LDJ-106): this morning, today, tonight, streaks and rates, and the optional cards, as
// blocks in your order (Edit home, from the ⋮ menu, ported from Motus): move them, show or hide each, reset. On a
// computer the blocks fill two columns in turn (first left, second right, ...) so a tall card leaves no hole beside a
// short one; on a phone one column in that order.
// Only titles of dreams appear here, never their text. Which night is which, the summary and the progress strings
// are pure (packages/shared/src/home.ts); the course texts and Learn's articles load with this page only.
import { computed, onUnmounted, ref, watch } from "vue";
import { HOME_BLOCKS, FIXED_HOME_BLOCKS, currentLesson, elementStats, frequencyText, signShortlist, homeNights, homeRates, morningState, nextReminder, checksOn, lastLucid, planDay, rcSchedule, tipIndex } from "@somnium/shared";
import { useJournal } from "../api/journal";
import { loadSignLexicons, signLexicons } from "../api/signs";
import { useTrain, tonightNight } from "../api/train";
import { loaded, saveSettings, useSettings } from "../api/queries";
import { confirm } from "../core/ask";
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
import DayNoteCard from "../components/home/DayNoteCard.vue";
import GoalCards from "../components/goals/GoalCards.vue";
import ForYouCard from "../components/ForYouCard.vue";
import Menu from "../components/Menu.vue";
import Icon from "../components/Icon.vue";
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

// ---- the blocks: name and what it shows (Edit home)
const META: Record<string, { name: string; desc: string }> = {
  morning: { name: "This morning", desc: "Last night's dreams, or a nudge to write them down" },
  today: { name: "Today", desc: "Reality checks and the lesson's practice for today" },
  tonight: { name: "Tonight", desc: "The technique and intention planned for tonight" },
  rates: { name: "Streaks and rates", desc: "Your journal streak, recall and lucid rate" },
  goals: { name: "Goals", desc: "Your goals and how close you are" },
  dayNote: { name: "Day note", desc: "A line about your day" },
  signs: { name: "Top dream signs", desc: "Your most frequent dream signs" },
  lesson: { name: "Next lesson", desc: "The course lesson you are on" },
  tip: { name: "A tip from Learn", desc: "A short article summary, a different one each day" },
  lastLucid: { name: "Last lucid dream", desc: "The title and date of your latest lucid dream" },
};
// a block whose feature is off is absent everywhere, Edit home included
const FEATURE: Record<string, string> = { goals: "goals", dayNote: "dayNotes" };
const on = computed(() => settings.value.features);
const available = (id: string) => !!META[id] && (!FEATURE[id] || !!on.value[FEATURE[id]!]);
const listed = computed(() => settings.value.home.blocks.filter((x) => available(x.id)));
const isOn = (id: string) => listed.value.some((x) => x.id === id && x.on);

// optional cards: null when switched off or with nothing to show, so they take no place in the columns
const lessonCard = computed(() => (isOn("lesson") && lesson.value ? { id: lesson.value.id, number: lesson.value.number, of: lessons.length, title: lesson.value.title, summary: lesson.value.summary } : null));
const tip = computed(() => {
  if (!isOn("tip")) return null;
  const pool = articles.filter((a) => a.summary);
  const a = pool[tipIndex(today.value, pool.length)];
  return a ? { id: a.id, title: a.title, summary: a.summary } : null;
});
watch(() => isOn("signs"), (v) => { if (v) void loadSignLexicons(); }, { immediate: true });
// top dream signs: the same shortlist as Signs, over every dream's facts (never the capped list)
const signs = computed(() => {
  if (!isOn("signs")) return null;
  const els = j.elements.data.value ?? [], facts = j.facts.data.value ?? [];
  const list = signShortlist(els, elementStats(els, j.links.data.value ?? [], facts, today.value), facts, signLexicons.value?.checks ?? [], today.value, 3);
  return list.map((x) => ({ id: x.element.id, name: x.element.name ?? "", line: [x.check ? `Check: ${x.check.name}` : "", frequencyText(x.frequency)].filter(Boolean).join(" · ") }));
});
const lucid = computed(() => {
  if (!isOn("lastLucid")) return null;
  const d = lastLucid(dreams.value);
  return d ? { id: d.id, date: d.date, title: d.title?.trim() || "Untitled dream" } : null;
});
const empty: Record<string, () => boolean> = { lesson: () => !lessonCard.value, tip: () => !tip.value, lastLucid: () => !lucid.value };
const shown = computed(() => listed.value.filter((x) => x.on && !empty[x.id]?.()).map((x) => x.id));
// two columns on a computer, filled in turn; For you leads the second (on a phone it follows the first block)
const columns = computed(() => isPhone.value ? [shown.value] : [shown.value.filter((_, i) => i % 2 === 0), shown.value.filter((_, i) => i % 2 === 1)]);

// ---- Edit home: every block, in order, with its arrows and its switch; changes save as you go
const editing = ref(false);
const setOn = (id: string, v: boolean) => saveSettings({ home: { blocks: settings.value.home.blocks.map((x) => (x.id === id ? { ...x, on: v } : x)) } }, { quiet: true });
// past the neighbour you can see (blocks of a switched-off feature keep their place)
function move(id: string, dir: -1 | 1) {
  const l = listed.value, other = l[l.findIndex((x) => x.id === id) + dir];
  if (!other) return;
  const all = [...settings.value.home.blocks], a = all.findIndex((x) => x.id === id), b = all.findIndex((x) => x.id === other.id);
  [all[a], all[b]] = [all[b]!, all[a]!];
  saveSettings({ home: { blocks: all } }, { quiet: true });
}
async function reset() {
  if (await confirm("Put Home back the way it started?", { text: "Blocks go back to their first order and switches.", ok: "Reset" })) saveSettings({ home: { blocks: HOME_BLOCKS } });
}
</script>

<template>
  <div class="page home">
    <div class="ph">
      <div v-if="editing"><h1>Edit home</h1><div class="sub">Move blocks and choose which show. Changes save as you go.</div></div>
      <div v-else><h1>Home</h1></div>
      <div class="acts">
        <template v-if="editing">
          <Menu :items="[{ label: 'Reset to default', icon: 'refresh', run: reset }]" />
          <button class="btn keep" @click="editing = false"><Icon name="check" :size="18" />Done</button>
        </template>
        <Menu v-else :items="[{ label: 'Edit home', icon: 'edit', run: () => (editing = true) }]" />
      </div>
    </div>

    <div v-if="editing" class="card"><TransitionGroup name="mv" tag="div" class="list">
      <div v-for="(x, i) in listed" :key="x.id" class="li hed" :class="{ off: !x.on && !FIXED_HOME_BLOCKS.has(x.id) }">
        <label class="grow" :for="`hb-${x.id}`"><div class="t">{{ META[x.id]!.name }}</div><div class="s">{{ META[x.id]!.desc }}</div></label>
        <button class="ib sm plain" :class="{ end: i === 0 }" :aria-disabled="i === 0" :aria-label="`Move ${META[x.id]!.name} earlier`" :title="`Move ${META[x.id]!.name} earlier`" @click="move(x.id, -1)"><Icon name="up" :size="18" /></button>
        <button class="ib sm plain" :class="{ end: i === listed.length - 1 }" :aria-disabled="i === listed.length - 1" :aria-label="`Move ${META[x.id]!.name} later`" :title="`Move ${META[x.id]!.name} later`" @click="move(x.id, 1)"><Icon name="down" :size="18" /></button>
        <span class="tg" :class="{ hfix: FIXED_HOME_BLOCKS.has(x.id) }"><input :id="`hb-${x.id}`" type="checkbox" :checked="x.on" :disabled="FIXED_HOME_BLOCKS.has(x.id)" :title="FIXED_HOME_BLOCKS.has(x.id) ? 'Always shown' : undefined" @change="setOn(x.id, ($event.target as HTMLInputElement).checked)" /></span>
      </div>
    </TransitionGroup></div>

    <div v-else class="grid hgrid" :class="{ g2: !isPhone }">
      <div v-for="(col, ci) in columns" :key="ci" class="hcol">
        <ForYouCard v-if="ci === 1" />
        <template v-for="(id, k) in col" :key="id">
          <MorningCard v-if="id === 'morning'" :state="morning" :date="when.lastNight" />
          <TodayCard v-else-if="id === 'today'" :done="checksDone" :planned="plan.today" :next="next" :reminders-on="remindersOn" :today="today" :primary="morning.kind !== 'open'"
            :lesson="lesson ? { id: lesson.id, title: lesson.title } : null" :items="items" />
          <TonightCard v-else-if="id === 'tonight'" :date="when.tonight" :same="when.same" :planned="planned" :intention="tonight?.intention ?? ''" />
          <RatesCard v-else-if="id === 'rates'" :rates="rates" />
          <GoalCards v-else-if="id === 'goals'" :today="today" />
          <DayNoteCard v-else-if="id === 'dayNote'" :today="today" />
          <ExtraCards v-else-if="id === 'signs'" :signs="signs" />
          <ExtraCards v-else-if="id === 'lesson'" :lesson="lessonCard" />
          <ExtraCards v-else-if="id === 'tip'" :tip="tip" />
          <ExtraCards v-else-if="id === 'lastLucid'" :lucid="lucid" />
          <ForYouCard v-if="isPhone && k === 0" />
        </template>
      </div>
    </div>
  </div>
</template>
