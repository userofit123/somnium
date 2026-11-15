<script setup lang="ts">
// "Today's step" (LDJ-107): the one thing to do now, at the top of Home, worked out by stepFor (packages/shared/src/
// nextStep.ts) from the lesson, the hour and what is logged. It holds Home's one primary button; the cards below stay
// quieter. It names counts and plans only, never dream text. Its "why" cites its sources, which open the same sheet as
// Learn. The Today checklist lists the practice items, so this card never repeats them.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { addDays, currentLesson, freeNightsOf, suggestTonight, withSuggestion, type Step, type StepLesson } from "@somnium/shared";
import { uuidv7, useJournal } from "../../api/journal";
import { useCourse } from "../../api/train";
import { useSettings } from "../../api/queries";
import Icon from "../Icon.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import CiteChips from "../learn/CiteChips.vue";
import "../../styles/components/learn.css";

const props = defineProps<{ step: Step; lesson: StepLesson | null; of: number; date: string; moving?: boolean }>();
const emit = defineEmits<{ moveOn: [] }>();
const router = useRouter();
const open = ref<string[] | null>(null);

// the "Plan tonight" line is the same suggestion Train · Tonight shows (WBTB only on a free night, never with sleep first)
const j = useJournal();
const course = useCourse();
const settings = useSettings();
const shown = computed(() => {
  const rows = course.data.value;
  if (props.step.kind !== "plan" || !rows) return props.step;
  const tonight = addDays(props.date, 1); // the step is shown from 18:00, when last night's date is the day before tonight's
  const wbtbNights = (j.nights.data.value ?? []).filter((n) => !n.nap && n.date !== tonight
    && (n.wbtbUsed || !!n.wbtbWakeAt || n.techniquesDone?.includes("wbtb") || n.techniquesPlanned?.includes("wbtb"))).map((n) => n.date);
  const s = settings.value;
  const sg = suggestTonight({ lesson: currentLesson(rows), date: tonight, freeNights: freeNightsOf(s.sleep.freeNights), sleepFirst: s.safety.sleepFirst, safetyChecked: s.safety.checked, wbtbNights });
  return withSuggestion(props.step, sg.title);
});

function act() {
  const a = shown.value.action;
  if (!a) return;
  if (a.run === "write") void router.push({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1", date: props.date } });
  else if (a.run === "moveOn") emit("moveOn");
  else if (a.to) void router.push(a.to);
}
const ICON: Record<string, string> = { write: "plus", moveOn: "up", finish: "check", checks: "check", plan: "moon", tonight: "moon", review: "moon", practice: "edit", done: "check" };
</script>

<template>
  <section class="hstep">
    <div class="sh"><h2>Today's step</h2><span v-if="lesson" class="tiny">Lesson {{ lesson.number }} of {{ of }} · {{ lesson.title }}</span></div>
    <div class="card">
      <div class="hst-head">
        <Icon :name="ICON[shown.kind] ?? 'check'" :size="20" />
        <div class="grow"><div class="hst-t">{{ shown.title }}</div><div v-if="shown.line" class="tiny num">{{ shown.line }}</div></div>
      </div>
      <p class="hst-why tiny"><b>Why:</b> {{ shown.why }} <CiteChips :ids="shown.sources" @cite="open = $event" /></p>
      <div class="hst-foot">
        <button v-if="shown.action" type="button" class="btn" :disabled="moving" @click="act">{{ shown.action.label }}</button>
        <router-link v-if="lesson && shown.action?.to !== `/train/lesson/${lesson.id}`" :to="`/train/lesson/${lesson.id}`" class="lnk inl tiny">Read the lesson</router-link>
      </div>
    </div>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
</template>
