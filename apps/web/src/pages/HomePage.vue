<script setup lang="ts">
// Home (PLAN.md §6.1, LDJ-33, LDJ-106): this morning, today, tonight, streaks and rates, and the optional cards, as
// blocks in your order (Edit home, from the ⋮ menu, ported from Motus): move them, show or hide each, reset. On a
// computer the blocks fill two columns in turn (first left, second right, ...) so a tall card leaves no hole beside a
// short one; on a phone one column in that order.
// Above the blocks, always: Today's step (LDJ-107), the one thing to do now from the lesson, the hour and what is
// logged (pure: packages/shared/src/nextStep.ts). It holds the page's primary button, so the cards below stay quiet.
// The header is Motus's: the greeting on a phone ("Home" on a computer, where the rail already names the page) and
// today's date under it (LDJ-121). The day's three blocks (This morning, Today, Tonight) lead with the one that fits
// the hour, in the places they hold in your order, and only while you keep them in their first order among themselves:
// once you move one past another in Edit home, your order wins at every hour. For you comes once, under them.
// Only titles of dreams appear here, never their text. Which night is which, the summary and the progress strings
// are pure (packages/shared/src/home.ts); the course texts and Learn's articles load with this page only.
import { computed, onUnmounted, ref, watch } from "vue";
import { HOME_BLOCKS, FIXED_HOME_BLOCKS, NIGHT_CUTOFF, retakeDue, nextLesson, stepFor, eveningOf, suggestTonight, freeNightsOf, wbtbNightsOf, frequencyText, topSigns, weekTarget, homeNights, homeRates, morningState, lastLucid, pastDream, tipIndex, type PastSign } from "@somnium/shared";
import { useJournal } from "../api/journal";
import { loadSignLexicons, signLexicons } from "../api/signs";
import { useTrain, tonightNight } from "../api/train";
import { useHabits } from "../components/train/useHabits";
import { useLesson } from "../components/train/useLesson";
import { useFmt } from "../core/format";
import { assessmentIds, recallBaseline } from "@somnium/knowledge/assessments";
import { loaded, saveSettings, useSettings } from "../api/queries";
import { confirm } from "../core/ask";
import { useToday } from "../core/today";
import "../styles/components/train.css";
import "../styles/components/home.css";
import MorningCard from "../components/home/MorningCard.vue";
import StepCard from "../components/home/StepCard.vue";
import WeekReviewCard from "../components/train/WeekReviewCard.vue";
import TodayChecklist from "../components/train/TodayChecklist.vue";
import TonightPlan from "../components/train/TonightPlan.vue";
import RatesCard from "../components/home/RatesCard.vue";
import ExtraCards from "../components/home/ExtraCards.vue";
import PathCard from "../components/insights/PathCard.vue";
import PastDreamCard from "../components/home/PastDreamCard.vue";
import { pastDreamPutAway, putPastDreamAway } from "../components/home/pastDream";
import DayNoteCard from "../components/home/DayNoteCard.vue";
import GoalCards from "../components/goals/GoalCards.vue";
import ForYouCard from "../components/ForYouCard.vue";
import Menu from "../components/Menu.vue";
import Icon from "../components/Icon.vue";
import { isPhone } from "../core/device";
import { useNeedsRecoveryKey, nudgeHidden, hideNudgeForAWeek } from "../core/recoveryNudge";
import { useRouter } from "vue-router";

const j = useJournal();
const t = useTrain();
const settings = useSettings();
// the texts load while the queries run, not before them
const [{ articles }, { lessons, findLesson, practiceItemId }, { findTechnique }] = await Promise.all([
  import("@somnium/knowledge/content"), import("@somnium/knowledge/course"), import("@somnium/knowledge/techniques"),
  loaded(j.nights, j.dreams, t.course, t.practice, t.checks),
]);

// reactive: the page can stay open across midnight
const today = useToday();
// the clock moves on while the page is open (the 05:00 turn): a minute's tick is enough here
const now = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 60_000);
onUnmounted(() => clearInterval(clock));
const when = computed(() => homeNights(today.value, new Date(now.value).getHours()));
const nights = computed(() => j.nights.data.value ?? []);
const dreams = computed(() => j.dreams.data.value ?? []);

const morning = computed(() => morningState(nights.value, dreams.value, when.value.lastNight));

// today's checklist (the same one as Train > Today): the lesson's practice items come from the course texts loaded above
// the lesson, its move-on rule and Move on, the same as Train works them out
const course = useLesson(findLesson, practiceItemId);
const lesson = course.lesson;
const checklistLesson = computed(() => (lesson.value ? { id: lesson.value.id, title: lesson.value.title, items: lesson.value.practice.map((text, i) => ({ id: practiceItemId(lesson.value!.id, i), text })) } : null));

// tonight
const tonight = computed(() => tonightNight(nights.value, when.value.tonight));
const titleOf = (id: string) => { const tq = findTechnique(id); return (tq && articles.find((a) => a.id === "techniques/" + tq.slug)?.title) ?? id.replace(/-/g, " "); };

// ---- today's step: the move-on rule as Train has it (useLesson), today's counts as the Today checklist has them, and
// tonight's suggested plan as Train · Tonight has it (suggestTonight, for the same night as the Tonight card)
const h = useHabits(), fmt = useFmt();
const hour = computed(() => new Date(now.value).getHours());
const suggestion = computed(() => {
  const s = settings.value, date = when.value.tonight;
  return suggestTonight({ lesson: course.current.value, date, freeNights: freeNightsOf(s.sleep.freeNights), sleepFirst: s.safety.sleepFirst, safetyChecked: s.safety.checked, wbtbNights: wbtbNightsOf(nights.value, date) });
});
const brief = (l: { id: string; number: number; title: string } | null | undefined) => (l ? { id: l.id, number: l.number, title: l.title } : null);
const stepLesson = computed(() => brief(lesson.value));
const step = computed(() => {
  const after = lesson.value ? nextLesson(lesson.value.id) : null;
  const wbtb = tonight.value?.wbtbWakeAt;
  return stepFor({
    hour: hour.value,
    lesson: stepLesson.value,
    next: brief(after ? findLesson(after) : null),
    wrote: morning.value.kind !== "open",
    ready: !!course.rule.value?.ready,
    checks: { done: h.checksToday.value, target: h.checkTarget.value },
    practice: { done: course.itemIds.value.filter((id) => h.rowOf(id)).length, total: course.itemIds.value.length },
    // before 05:00 the evening is still last evening's: a review done at 22:00 counts at 01:00
    reviewed: !!h.rowAt("habit:review", eveningOf(today.value, hour.value)),
    tonight: { title: suggestion.value.title, reason: suggestion.value.reason, planned: !!tonight.value?.techniquesPlanned?.length, wbtbAt: wbtb ? fmt.value.time(wbtb) : null },
  });
});

// set against the setup's recall answer when there is one (LDJ-180), as Progress · Recall does
const rates = computed(() => homeRates(nights.value, dreams.value, today.value, undefined, recallBaseline(settings.value.setup.recall)));

// ---- the blocks: name and what it shows (Edit home)
const META: Record<string, { name: string; desc: string }> = {
  morning: { name: "This morning", desc: "Last night's dreams, or a nudge to write them down" },
  today: { name: "Today", desc: "Your checklist for today: journal, reality checks, practice, dream sign" },
  tonight: { name: "Tonight", desc: "Tonight's techniques, intention, bedtime and WBTB alarm" },
  rates: { name: "Streaks and rates", desc: "Your journal streak, recall and lucid rate" },
  goals: { name: "Goals", desc: "Your goals and how close you are" },
  dayNote: { name: "Day note", desc: "A line about your day" },
  signs: { name: "Top dream signs", desc: "Your most frequent dream signs" },
  lesson: { name: "Next lesson", desc: "The course lesson you are on" },
  tip: { name: "A tip from Learn", desc: "A short article summary, a different one each day" },
  lastLucid: { name: "Last lucid dream", desc: "The title and date of your latest lucid dream" },
  pastDream: { name: "From your journal", desc: "A past dream to re-read, a different one each day" },
  path: { name: "Your path", desc: "Your latest milestone and the next one" },
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
// top dream signs: the same shortlist as Signs (recurring dreams first), over every dream's facts (never the capped list)
const signs = computed(() => {
  if (!isOn("signs")) return null;
  const els = j.elements.data.value ?? [], facts = j.facts.data.value ?? [];
  const list = topSigns(els, j.links.data.value ?? [], facts, signLexicons.value?.checks ?? [], today.value, 3, { target: weekTarget(settings.value) });
  return list.map((x) => ({ id: x.element.id, name: x.element.name ?? "", line: [x.check ? `Check: ${x.check.name}` : "", frequencyText(x.frequency)].filter(Boolean).join(" · ") }));
});
const lucid = computed(() => {
  if (!isOn("lastLucid")) return null;
  const d = lastLucid(dreams.value);
  return d ? { id: d.id, date: d.date, title: d.title?.trim() || "Untitled dream" } : null;
});
// a past dream to re-read (LDJ-161), preferring ones that held a dream sign: the dream signs each dream held, by name
const past = computed(() => {
  if (!isOn("pastDream") || pastDreamPutAway(today.value)) return null;
  const sign = new Map((j.elements.data.value ?? []).filter((e) => e.isDreamSign).map((e) => [e.id, e.name ?? ""]));
  const held = new Map<string, PastSign[]>();
  for (const l of j.links.data.value ?? []) {
    const name = sign.get(l.elementId);
    if (name === undefined) continue;
    const list = held.get(l.dreamId) ?? [];
    if (!list.some((x) => x.id === l.elementId)) held.set(l.dreamId, [...list, { id: l.elementId, name }]);
  }
  const p = pastDream(dreams.value, today.value, held, weekTarget(settings.value));
  return p ? { id: p.dream.id, date: p.dream.date, title: p.dream.title!.trim(), why: p.why } : null;
});
const empty: Record<string, () => boolean> = { lesson: () => !lessonCard.value, tip: () => !tip.value, lastLucid: () => !lucid.value, pastDream: () => !past.value };

// ---- the time of day (LDJ-121), Motus's greeting, on the same hour as the page's other clocks
const greeting = computed(() => { const hr = hour.value; return hr < NIGHT_CUTOFF ? "Good night" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"; });
// the day's blocks in their first order, and the order that fits the hour: the morning's write-down first until noon,
// the day's checklist in the afternoon, tonight's plan from 18:00 until the 05:00 turn (the night is still on)
const DAY = ["morning", "today", "tonight"];
const dayOrder = computed(() => {
  const hr = hour.value;
  return hr >= NIGHT_CUTOFF && hr < 12 ? DAY : hr >= 12 && hr < 18 ? ["today", "tonight", "morning"] : ["tonight", "today", "morning"];
});
// four weeks after the newest self-assessment answer, one quiet row asks for the two questions again (as Progress ·
// Self-assessment works it out); never a block in Edit home, and gone once answered
const retake = computed(() => retakeDue(assessmentIds.map((id) => settings.value.learn.assessments[id]?.at(-1)?.date), today.value));
const visible = computed(() => listed.value.filter((x) => x.on && !empty[x.id]?.()).map((x) => x.id));
// the day's blocks swap among the places they hold, so every other block stays where you put it; a person who has
// put them in an order of their own keeps it
const shown = computed(() => {
  const ids = [...visible.value], at = ids.flatMap((id, i) => (DAY.includes(id) ? [i] : []));
  const mine = at.map((i) => ids[i]!);
  const first = mine.every((id, k) => k === 0 || DAY.indexOf(id) > DAY.indexOf(mine[k - 1]!));
  if (first) {
    const timed = dayOrder.value.filter((id) => mine.includes(id));
    at.forEach((i, k) => { ids[i] = timed[k]!; });
  }
  // For you once, under the day's blocks (at the top when none of them shows), and under it the retake line when due
  ids.splice(at.length ? at[at.length - 1]! + 1 : 0, 0, ...(retake.value ? ["forYou", "retake"] : ["forYou"]));
  return ids;
});
// two columns on a computer, filled in turn; on a phone one column
const columns = computed(() => isPhone.value ? [shown.value] : [shown.value.filter((_, i) => i % 2 === 0), shown.value.filter((_, i) => i % 2 === 1)]);

// ---- the recovery key reminder (LDJ-151): above the blocks while there is none, "Later" puts it away for a week.
// Not a block in Edit home: it goes for good once the key is made. It says nothing about the journal.
const router = useRouter();
const needsKey = useNeedsRecoveryKey();
const keyNudge = computed(() => needsKey.value && !nudgeHidden());

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
      <div v-if="editing"><h1>Edit home</h1><div class="sub">Move blocks and choose which show. Changes save as you go. Until you move This morning, Today or Tonight past one another, they follow the time of day.</div></div>
      <div v-else><h1>{{ isPhone ? greeting : "Home" }}</h1><div class="sub">{{ fmt.dateLong(today) }}</div></div>
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

    <div v-if="!editing && keyNudge" class="card hkey" role="status">
      <div class="li"><Icon name="key" :size="20" class="muted" />
        <div class="grow"><div class="t">Make your recovery key</div><div class="s">Nobody can send you your password. Without the key, a forgotten one locks your journal for good.</div></div></div>
      <div class="hkey-acts"><button class="btn tonal s" @click="hideNudgeForAWeek">Later</button><button class="btn tonal s" @click="router.push('/settings/security')">Make key</button></div>
    </div>
    <!-- the step and the cards wait for every list the step reads, so it never names a wrong step for a moment and
         never pushes the cards down when it comes in -->
    <StepCard v-if="!editing && h.ready.value" :step="step" :lesson="stepLesson" :of="lessons.length" :date="when.lastNight" :moving="course.moving.value" @move-on="course.next" />
    <!-- the weekly review, on the review evening only (optional feature, LDJ-155) -->
    <WeekReviewCard v-if="!editing && h.ready.value" home />
    <div v-if="!editing && h.ready.value" class="grid hgrid" :class="{ g2: !isPhone }">
      <div v-for="(col, ci) in columns" :key="ci" class="hcol">
        <template v-for="id in col" :key="id">
          <ForYouCard v-if="id === 'forYou'" />
          <div v-else-if="id === 'retake'" class="card flush hretake"><router-link to="/progress/self-assessment" class="li click">
            <span class="bi"><Icon name="refresh" :size="18" /></span>
            <div class="grow"><div class="t">Four weeks on: answer two questions again</div></div>
            <Icon name="right" :size="16" class="muted" />
          </router-link></div>
          <MorningCard v-else-if="id === 'morning'" :state="morning" :date="when.lastNight" />
          <TodayChecklist v-else-if="id === 'today'" :lesson="checklistLesson" home />
          <TonightPlan v-else-if="id === 'tonight'" compact :night="tonight" :date="when.tonight" :same="when.same" :title-of="titleOf" />
          <RatesCard v-else-if="id === 'rates'" :rates="rates" />
          <GoalCards v-else-if="id === 'goals'" compact :today="today" />
          <DayNoteCard v-else-if="id === 'dayNote'" :today="today" />
          <ExtraCards v-else-if="id === 'signs'" :signs="signs" />
          <ExtraCards v-else-if="id === 'lesson'" :lesson="lessonCard" />
          <ExtraCards v-else-if="id === 'tip'" :tip="tip" />
          <ExtraCards v-else-if="id === 'lastLucid'" :lucid="lucid" />
          <PathCard v-else-if="id === 'path'" home />
          <PastDreamCard v-else-if="id === 'pastDream' && past" :past="past" @not-now="putPastDreamAway(today)" />
        </template>
      </div>
    </div>
  </div>
</template>
