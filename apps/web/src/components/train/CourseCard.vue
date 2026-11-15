<script setup lang="ts">
// "Your course" (LDJ-24): the current lesson and how close the move-on rule is. Its practice items are ticked in the
// Today checklist beside it (LDJ-97), never twice. The rule never blocks: "Move on" is the primary button once it is
// met, and a quiet link before that.
import { computed } from "vue";
import type { MoveOn } from "@somnium/shared";
import { lessons, type Lesson } from "@somnium/knowledge/course";
import Icon from "../Icon.vue";
import ProgressBar from "../ProgressBar.vue";

const props = defineProps<{ lesson: Lesson | null; rule: MoveOn | null; moving: boolean }>();
const emit = defineEmits<{ moveOn: [] }>();
const pct = computed(() => Math.round((props.rule?.share ?? 0) * 100));
</script>

<template>
  <section class="tcourse">
    <div class="sh"><h2>Your course</h2><span v-if="lesson" class="tiny">Lesson {{ lesson.number }} of {{ lessons.length }}</span></div>
    <div v-if="!lesson" class="card empty"><Icon name="graduation" :size="34" /><b>Course finished</b>All eight lessons are done. The techniques are yours to use whenever you like.<br /><router-link to="/train/techniques" class="btn tonal">See the techniques</router-link></div>
    <div v-else class="card">
      <div class="tlh">
        <div class="t">{{ lesson.title }}</div>
        <div class="tiny">{{ lesson.summary }}</div>
        <router-link :to="'/train/lesson/' + lesson.id" class="lnk inl tiny">Read the lesson</router-link>
      </div>
      <div v-if="rule" class="tmove">
        <ProgressBar :percent="pct" label="Progress towards moving on" />
        <div class="tmrow">
          <div class="grow"><div class="tprog">{{ rule.progress }}</div><div class="tiny">{{ rule.reason }}</div></div>
          <button v-if="rule.ready" class="btn" :disabled="moving" @click="emit('moveOn')">{{ lesson.number === lessons.length ? "Finish the course" : "Move on" }}</button>
        </div>
        <button v-if="!rule.ready" type="button" class="lnk inl tiny" :disabled="moving" @click="emit('moveOn')">{{ lesson.number === lessons.length ? "Finish the course now" : "Move on now" }}</button>
      </div>
    </div>
  </section>
</template>
