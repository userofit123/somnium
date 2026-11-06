<script setup lang="ts">
// Train (PLAN.md §6.4): the course (LDJ-24), tonight's plan and the techniques library (LDJ-23). /train?technique=<id>
// opens a technique (Learn's "Try it" links land there) and /train?lesson=<id> a lesson. On a computer the course and
// tonight's plan sit beside the library; on a phone it is one column. Everything Train shows (the lesson and article
// texts) loads with this page only: it is a lazy route, so the first screen stays small.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { currentLesson, nextLesson, moveOn } from "@somnium/shared";
import { findLesson, practiceItemId } from "@somnium/knowledge/course";
import { findTechnique } from "@somnium/knowledge/techniques";
import { useJournal } from "../api/journal";
import { useTrain, setLesson, tonightNight } from "../api/train";
import { loaded } from "../api/queries";
import { localYmd } from "../core/format";
import { toastError } from "../core/toast";
import "../styles/components/learn.css";
import "../styles/components/train.css";
import CourseCard from "../components/train/CourseCard.vue";
import TonightCard from "../components/train/TonightCard.vue";
import TechniqueLibrary from "../components/train/TechniqueLibrary.vue";
import TechniqueView from "../components/train/TechniqueView.vue";
import LessonView from "../components/train/LessonView.vue";

const route = useRoute();
const router = useRouter();
const j = useJournal();
const t = useTrain();
await loaded(j.nights, t.course, t.practice);

const today = localYmd(new Date());
const technique = computed(() => findTechnique(String(route.query.technique ?? "")));
const openLesson = computed(() => findLesson(String(route.query.lesson ?? "")));

const rows = computed(() => t.course.data.value ?? []);
const current = computed(() => currentLesson(rows.value));
const lesson = computed(() => (current.value ? findLesson(current.value) ?? null : null));
const row = computed(() => rows.value.find((r) => r.lessonId === current.value));
const planned = computed(() => tonightNight(j.nights.data.value)?.techniquesPlanned ?? []);

const rule = computed(() => {
  if (!lesson.value) return null;
  return moveOn(lesson.value.id, {
    today,
    since: row.value ? localYmd(new Date(row.value.updatedAt)) : today,
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
    <TechniqueView v-if="technique" :key="technique.id" :technique="technique" :planned="planned.includes(technique.id)" />
    <LessonView v-else-if="openLesson" :key="openLesson.id" :lesson="openLesson" />
    <template v-else>
      <div class="ph"><div><h1>Train</h1></div><div class="acts"><button class="btn o s keep" @click="router.push('/check')">Log a check</button></div></div>
      <div class="grid g2 tgrid">
        <div class="tcol">
          <CourseCard :lesson="lesson" :row="row" :practice="t.practice.data.value ?? []" :today="today" :rule="rule" :moving="moving" @move-on="next" />
          <TonightCard :planned="planned" />
        </div>
        <div class="tcol">
          <TechniqueLibrary :planned="planned" />
        </div>
      </div>
    </template>
  </div>
</template>
