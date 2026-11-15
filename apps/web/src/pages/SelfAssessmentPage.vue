<script setup lang="ts">
// Self-assessment (PLAN.md §6.5, §6.6; LDJ-127): the lucid dream frequency and dream recall frequency scales, worded
// as in RESEARCH.md. Answered here and kept with the date in the settings; Progress · Self-assessment shows them over
// time, and Learn links here, so the questions and their answers have one home. The DLQ is not offered because
// RESEARCH.md does not list its items. ?scale=madre opens on that question.
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { assessments, assessmentIds, optionFor, type AssessmentId } from "@somnium/knowledge/assessments";
import { useLearn, saveAnswer } from "../core/learn";
import { localYmd, useFmt } from "../core/format";
import { goBack, backLabel } from "../core/leave";
import ChoiceTiles from "../components/ChoiceTiles.vue";
import Icon from "../components/Icon.vue";
import "../styles/components/learn.css";

const route = useRoute(), router = useRouter();
const back = backLabel(router, "Progress");
const { answers } = useLearn();
const fmt = useFmt();
const which = ref<AssessmentId>(assessmentIds.includes(route.query.scale as AssessmentId) ? (route.query.scale as AssessmentId) : "ldfs");
const pick = ref<number | null>(null);
const a = computed(() => assessments[which.value]);
const last = computed(() => answers.value[which.value].at(-1));
const options = computed(() => a.value.options.map((o) => ({ value: o.value, label: o.label })));
const busy = ref(false);
function choose(id: AssessmentId) { which.value = id; pick.value = null; }
// after one answer, the other question if it has not been answered today; after both, back to where the answers show
async function save() {
  if (pick.value == null) return;
  busy.value = true;
  try { await saveAnswer(which.value, answers.value[which.value], pick.value); } finally { busy.value = false; }
  pick.value = null;
  const today = localYmd(new Date());
  const next = assessmentIds.find((id) => answers.value[id].at(-1)?.date !== today);
  if (next) which.value = next; else goBack(router, "/progress");
}
const date = (d: string) => fmt.value.date(d, { day: "numeric", month: "short", year: "numeric" });
</script>

<template>
  <div class="page art">
    <div class="ph"><div><button type="button" class="back" @click="goBack(router, '/progress')"><Icon name="left" :size="16" /><span>{{ back }}</span></button><h1>Self-assessment</h1><div class="sub">Two short questions that show where you start and how it changes. Answer them again every four weeks or so; each answer is kept with its date and shows in Progress.</div></div></div>
    <div class="seg" role="tablist"><button v-for="id in assessmentIds" :key="id" type="button" role="tab" :class="{ on: which === id }" :aria-selected="which === id" @click="choose(id)">{{ assessments[id].title }}</button></div>
    <div class="card qcard">
      <div class="ch"><span class="t">{{ a.title }}</span></div>
      <p v-if="a.definition" class="qdef">{{ a.definition }}</p>
      <ChoiceTiles v-model="pick" :options="options" :min="'220px'" :label="a.title" />
      <div class="qfoot">
        <span class="s">{{ a.source }}<template v-if="last"> · Last answer: {{ optionFor(which, last.value)?.label }} · {{ date(last.date) }}</template></span>
        <button type="button" class="btn" :disabled="pick == null || busy" @click="save">Save answer</button>
      </div>
    </div>
  </div>
</template>
