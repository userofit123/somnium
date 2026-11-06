<script setup lang="ts">
// "Where am I": the lucid dream frequency and dream recall frequency scales, worded as in RESEARCH.md.
// Answers are saved with the date in the settings, so Insights can show how they change. The DLQ is not
// offered because RESEARCH.md does not list its items.
import { computed, ref } from "vue";
import { assessments, assessmentIds, optionFor, type AssessmentId } from "@somnium/knowledge/assessments";
import { useLearn, saveAnswer } from "../../core/learn";
import { useFmt } from "../../core/format";
import ChoiceTiles from "../ChoiceTiles.vue";

const { answers } = useLearn();
const fmt = useFmt();
const which = ref<AssessmentId>("ldfs");
const pick = ref<number | null>(null);
const a = computed(() => assessments[which.value]);
const history = computed(() => [...answers.value[which.value]].reverse());
const options = computed(() => a.value.options.map((o) => ({ value: o.value, label: o.label })));
const busy = ref(false);
function choose(id: AssessmentId) { which.value = id; pick.value = null; }
async function save() {
  if (pick.value == null) return;
  busy.value = true;
  try { await saveAnswer(which.value, answers.value[which.value], pick.value); pick.value = null; } finally { busy.value = false; }
}
const rate = (id: AssessmentId, v: number) => { const r = optionFor(id, v)?.rate ?? 0; return `Counted as ${r} ${assessments[id].unit}`; };
const date = (d: string) => fmt.value.date(d, { day: "numeric", month: "short", year: "numeric" });
</script>

<template>
  <div class="art">
    <h1>Where am I</h1>
    <p class="lede">Two short questions that show where you start and how it changes. Answer again whenever you like; each answer is kept with its date.</p>
    <div class="seg" role="tablist"><button v-for="id in assessmentIds" :key="id" type="button" role="tab" :class="{ on: which === id }" :aria-selected="which === id" @click="choose(id)">{{ assessments[id].title }}</button></div>
    <div class="card qcard">
      <div class="ch"><span class="t">{{ a.title }}</span></div>
      <p v-if="a.definition" class="qdef">{{ a.definition }}</p>
      <ChoiceTiles v-model="pick" :options="options" :min="'220px'" :label="a.title" />
      <div class="qfoot">
        <span class="s">{{ a.source }}</span>
        <button type="button" class="btn" :disabled="pick == null || busy" @click="save">Save answer</button>
      </div>
    </div>
    <h2 v-if="history.length" class="qh">Your answers</h2>
    <div v-if="history.length" class="card flush">
      <div v-for="h in history" :key="h.date" class="li">
        <div class="grow"><div class="t">{{ optionFor(which, h.value)?.label }}</div><div class="s">{{ rate(which, h.value) }}</div></div>
        <div class="r s">{{ date(h.date) }}</div>
      </div>
    </div>
  </div>
</template>
