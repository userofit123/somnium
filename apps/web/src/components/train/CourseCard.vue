<script setup lang="ts">
// "Your course" (LDJ-24): the current lesson, today's practice ticks (practice_log) and how close the move-on rule
// is. The rule never blocks: "Move on" is the primary button once it is met, and a quiet link before that.
import { computed } from "vue";
import type { CourseProgress, PracticeLog, MoveOn } from "@somnium/shared";
import { lessons, practiceItemId, type Lesson } from "@somnium/knowledge/course";
import { tickPractice } from "../../api/train";
import { useChange } from "../../api/queries";
import Icon from "../Icon.vue";

const props = defineProps<{ lesson: Lesson | null; row?: CourseProgress; practice: PracticeLog[]; today: string; rule: MoveOn | null; moving: boolean }>();
const emit = defineEmits<{ moveOn: [] }>();
const items = computed(() => (props.lesson?.practice ?? []).map((text, i) => {
  const id = practiceItemId(props.lesson!.id, i);
  return { id, text, row: props.practice.find((p) => p.item === id && p.date === props.today && p.done) };
}));
const tick = useChange((id: string, on: boolean, row?: PracticeLog) => tickPractice(id, props.today, on, row), ["practice"]);
const pct = computed(() => Math.round((props.rule?.share ?? 0) * 100));
</script>

<template>
  <section class="tcourse">
    <div class="sh"><h2>Your course</h2><span v-if="lesson" class="tiny">Lesson {{ lesson.number }} of {{ lessons.length }}</span></div>
    <div v-if="!lesson" class="card empty"><b>Course finished</b>All eight lessons are done. The techniques below are yours to use whenever you like.</div>
    <div v-else class="card">
      <div class="tlh">
        <div class="t">{{ lesson.title }}</div>
        <div class="tiny">{{ lesson.summary }}</div>
        <router-link :to="{ path: '/train', query: { lesson: lesson.id } }" class="lnk inl tiny">Read the lesson</router-link>
      </div>
      <div class="tiny tsub">Today's practice</div>
      <div class="tcheck">
        <button v-for="it in items" :key="it.id" type="button" class="tck" :class="{ on: !!it.row }" role="checkbox" :aria-checked="!!it.row"
          :disabled="tick.busy.value" @click="tick.run(it.id, !it.row, it.row)">
          <span class="box"><Icon v-if="it.row" name="check" :size="14" /></span><span class="txt">{{ it.text }}</span>
        </button>
      </div>
      <div v-if="rule" class="tmove">
        <div class="tbar" role="progressbar" aria-label="Progress towards moving on" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: pct + '%' }" /></div>
        <div class="tmrow">
          <div class="grow"><div class="tprog">{{ rule.progress }}</div><div class="tiny">{{ rule.reason }}</div></div>
          <button v-if="rule.ready" class="btn" :disabled="moving" @click="emit('moveOn')">{{ lesson.number === lessons.length ? "Finish the course" : "Move on" }}</button>
        </div>
        <button v-if="!rule.ready" type="button" class="lnk inl tiny" :disabled="moving" @click="emit('moveOn')">{{ lesson.number === lessons.length ? "Finish the course now" : "Move on now" }}</button>
      </div>
    </div>
  </section>
</template>
