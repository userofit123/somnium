<script setup lang="ts">
// "Today's step" (LDJ-107): the one thing to do now, at the top of Home, worked out by stepFor (packages/shared/src/
// nextStep.ts) from the lesson, the hour and what is logged. It holds Home's one primary button; the cards below stay
// quieter. It names counts and plans only, never dream text. Its "why" cites its sources, which open the same sheet as
// Learn. It reads title, short line, why, one button: the label row carries the only icon, so nothing says it twice.
// The Today checklist lists the practice items, so this card never repeats them. While the step is the morning's
// write-down it also holds "No recall", and Home leaves the This morning hero out: one call to write, not two.
import { ref } from "vue";
import { useRouter } from "vue-router";
import type { Step, StepLesson } from "@somnium/shared";
import { markNoRecall, uuidv7 } from "../../api/journal";
import { useChange } from "../../api/queries";
import Icon from "../Icon.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import CiteChips from "../learn/CiteChips.vue";
import "../../styles/components/learn.css";

const props = defineProps<{ step: Step; lesson: StepLesson | null; of: number; date: string; moving?: boolean }>();
const emit = defineEmits<{ moveOn: [] }>();
const router = useRouter();
const open = ref<string[] | null>(null);
function act() {
  const a = props.step.action;
  if (!a) return;
  if (a.run === "write") void router.push({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1", date: props.date } });
  else if (a.run === "moveOn") emit("moveOn");
  else if (a.to) void router.push(a.to);
}
const noRecall = useChange(() => markNoRecall(props.date), ["journal", "home"]);
</script>

<template>
  <section class="hstep">
    <div class="card">
      <div class="lbl hgap"><span class="bi"><Icon name="target" :size="16" /></span><span class="grow">Today's step</span><span v-if="lesson" class="tiny">Lesson {{ lesson.number }} of {{ of }} · {{ lesson.title }}</span></div>
      <div><div class="hst-t">{{ step.title }}</div><div v-if="step.line" class="tiny num">{{ step.line }}</div></div>
      <p class="hst-why tiny"><b>Why:</b> {{ step.why }} <CiteChips :ids="step.sources" @cite="open = $event" /></p>
      <div class="hst-foot">
        <button v-if="step.action" type="button" class="btn" :disabled="moving" @click="act">{{ step.action.label }}</button>
        <button v-if="step.kind === 'write'" type="button" class="lnk inl" :disabled="noRecall.busy.value" @click="noRecall.run()">No recall</button>
        <router-link v-else-if="lesson && step.action?.to !== `/train/lesson/${lesson.id}`" :to="`/train/lesson/${lesson.id}`" class="lnk inl">Read the lesson</router-link>
      </div>
    </div>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
</template>
