<script setup lang="ts">
// Train (PLAN.md §6.3) in three tabs, each its own address: Today (/train: the course lesson, today's checklist, memory
// targets, meditation and dream yoga when on), Tonight (/train/tonight: the one place to plan the night, LDJ-96, then the bedtime starts and the evening review)
// and Techniques (/train/techniques: the library and the guided tools). The sub-screens have addresses too:
// /train/technique/:id (Learn's "Try it" lands there), /train/lesson/:id, /train/guided/:mode and /train/review; their
// Back returns to where you came from (core/leave.ts). The shells keep this page mounted across the three tabs, so
// switching tabs doesn't reload it; the underline (.tabs) simply moves to the active tab, it doesn't animate. Everything
// Train shows (the lesson and article texts) loads with this page only: it is a lazy route, so the first screen stays small.
import { computed, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { currentLesson, nextLesson, moveOn } from "@somnium/shared";
import { findLesson, practiceItemId } from "@somnium/knowledge/course";
import { findTechnique } from "@somnium/knowledge/techniques";
import { articles } from "@somnium/knowledge/content";
import { useJournal } from "../api/journal";
import { useTrain, setLesson, tonightNight, tonightDate } from "../api/train";
import { loaded } from "../api/queries";
import { localYmd } from "../core/format";
import { useToday } from "../core/today";
import { toastError } from "../core/toast";
import "../styles/components/learn.css";
import "../styles/components/train.css";
import CourseCard from "../components/train/CourseCard.vue";
import TonightPlan from "../components/train/TonightPlan.vue";
import TechniqueLibrary from "../components/train/TechniqueLibrary.vue";
import TechniqueView from "../components/train/TechniqueView.vue";
import LessonView from "../components/train/LessonView.vue";
import GuidedCard from "../components/train/guided/GuidedCard.vue";
import { defineAsyncComponent } from "vue";
import { nightNowDate } from "../api/train";
import type { GuidedMode } from "../components/train/guided/GuidedView.vue";
// the guided modes (LDJ-25) load when one opens: /train/guided/wbtb|up|mild|ssild|wild|drill|cat|cue
const GuidedView = defineAsyncComponent(() => import("../components/train/guided/GuidedView.vue"));
import TodayChecklist from "../components/train/TodayChecklist.vue";
import PmCard from "../components/train/PmCard.vue";
import ReviewView from "../components/train/ReviewView.vue";
import MeditationCard from "../components/train/MeditationCard.vue";
import DreamYogaCard from "../components/train/DreamYogaCard.vue";
import { useSettings } from "../api/queries";

const useSettingsOn = useSettings();
const route = useRoute();
const router = useRouter();
const j = useJournal();
const t = useTrain();
await loaded(j.nights, t.course, t.practice);

// reactive: the page can stay open across midnight
const today = useToday();
const TABS = [["train", "Today", "/train"], ["train-tonight", "Tonight", "/train/tonight"], ["train-techniques", "Techniques", "/train/techniques"]] as const;
const isTab = (name: unknown) => TABS.some(([n]) => n === name);
// what this copy of the page shows. The shells give each sub-screen its own copy (and the three tabs one between them):
// while one fades out, the route has already moved on, so it keeps showing what it was opened for
const snap = () => ({ name: route.name, path: route.path, params: { ...route.params } });
const here = shallowRef(snap());
watch(() => route.fullPath, () => { if (isTab(here.value.name) ? isTab(route.name) : route.path === here.value.path) here.value = snap(); });
const tab = computed(() => TABS.find(([n]) => n === here.value.name)?.[0] ?? null);
const param = (k: string) => String(here.value.params[k] ?? "");
const technique = computed(() => (here.value.name === "train-technique" ? findTechnique(param("id")) : undefined));
const openLesson = computed(() => (here.value.name === "train-lesson" ? findLesson(param("id")) : undefined));
// the sound cue is an optional feature: absent while off, even by its address
const guided = computed(() => (here.value.name !== "train-guided" ? undefined : (["wbtb", "up", "mild", "ssild", "wild", "drill", "cue", "cat"] as const)
  .find((m) => m === param("mode") && (m !== "cue" || !!useSettingsOn.value.features.soundCue)) as GuidedMode | undefined));
// an address that names nothing (a technique, lesson or mode that isn't there, the cue while off) goes to the tab it
// would be opened from
const lost = computed(() => {
  const n = here.value.name;
  if ((n === "train-technique" && !technique.value) || (n === "train-guided" && !guided.value)) return "/train/techniques";
  return n === "train-lesson" && !openLesson.value ? "/train" : "";
});
watch(lost, (to) => { if (to && route.path === here.value.path) void router.replace(to); }, { immediate: true });
// tonight's WBTB alarm, or, in the small hours and the morning after it, the one of the night now ending
const wbtbAt = computed(() => tonightNight(j.nights.data.value)?.wbtbWakeAt ?? tonightNight(j.nights.data.value, nightNowDate())?.wbtbWakeAt ?? null);

const features = computed(() => useSettingsOn.value.features);
const rows = computed(() => t.course.data.value ?? []);
const current = computed(() => currentLesson(rows.value));
const lesson = computed(() => (current.value ? findLesson(current.value) ?? null : null));
const row = computed(() => rows.value.find((r) => r.lessonId === current.value));
const tonight = computed(() => tonightNight(j.nights.data.value, tonightDate()));
const planned = computed(() => tonight.value?.techniquesPlanned ?? []);
const titleOf = (id: string) => { const tq = findTechnique(id); return (tq && articles.find((a) => a.id === "techniques/" + tq.slug)?.title) ?? id.replace(/-/g, " "); };

// the lesson's practice items for the Today checklist (ticked there, not on the course card)
const checklistLesson = computed(() => (lesson.value ? { id: lesson.value.id, title: lesson.value.title, items: lesson.value.practice.map((text, i) => ({ id: practiceItemId(lesson.value!.id, i), text })) } : null));

const rule = computed(() => {
  if (!lesson.value) return null;
  return moveOn(lesson.value.id, {
    today: today.value,
    // the lesson's fixed start (set once when it became active); a row from before it existed falls back to creation
    since: row.value ? localYmd(new Date(row.value.startedAt ?? row.value.createdAt)) : today.value,
    nights: j.nights.data.value ?? [],
    checkDays: (t.checks.data.value ?? []).map((c) => localYmd(new Date(c.at))),
    practice: t.practice.data.value ?? [],
    items: lesson.value.practice.map((_, i) => practiceItemId(lesson.value!.id, i)),
  });
});

// the lesson in front of you is the current one in course_progress: written once, so the rules know when it began
let started = "";
watch([() => t.course.isSuccess.value, current], ([ok, id]) => {
  if (!ok || !id || row.value?.state === "active" || started === id) return;
  started = id;
  setLesson(id, "active", row.value).catch(toastError);
}, { immediate: true });

const moving = ref(false);
async function next() {
  if (!lesson.value) return;
  moving.value = true;
  try {
    const id = lesson.value.id, after = nextLesson(id);
    started = after ?? "";
    await setLesson(id, "done", row.value);
    if (after) await setLesson(after, "active", rows.value.find((r) => r.lessonId === after));
  } catch (e) { toastError(e); } finally { moving.value = false; }
}
</script>

<template>
  <div class="page train">
    <GuidedView v-if="guided" :key="guided" :mode="guided" />
    <TechniqueView v-else-if="technique" :key="technique.id" :technique="technique" :planned="planned.includes(technique.id)" />
    <ReviewView v-else-if="here.name === 'train-review'" />
    <LessonView v-else-if="openLesson" :key="openLesson.id" :lesson="openLesson" />
    <template v-else-if="tab">
      <div class="ph"><div><h1>Train</h1></div></div>
      <div class="tabs" role="tablist" aria-label="Train"><button v-for="[n, l, to] in TABS" :key="n" type="button" role="tab" :aria-selected="tab === n" :class="{ on: tab === n }" @click="router.replace(to)">{{ l }}</button></div>
      <Transition name="sw" mode="out-in">
        <div v-if="tab === 'train'" key="today" class="grid g2 tgrid">
          <div class="tcol">
            <CourseCard :lesson="lesson" :rule="rule" :moving="moving" @move-on="next" />
            <TodayChecklist :lesson="checklistLesson" />
          </div>
          <div class="tcol">
            <PmCard />
            <MeditationCard v-if="features.meditationTimer" />
            <DreamYogaCard v-if="features.dreamYoga" />
          </div>
        </div>
        <div v-else-if="tab === 'train-tonight'" key="tonight" class="grid g2 tgrid">
          <div class="tcol"><TonightPlan :night="tonight" :date="tonightDate()" :title-of="titleOf" /></div>
          <div class="tcol"><GuidedCard :wake-at="wbtbAt" group="tonight" /></div>
        </div>
        <div v-else key="techniques" class="grid g2 tgrid">
          <div class="tcol"><TechniqueLibrary :planned="planned" /></div>
          <div class="tcol"><GuidedCard :wake-at="wbtbAt" group="tools" /></div>
        </div>
      </Transition>
    </template>
  </div>
</template>
