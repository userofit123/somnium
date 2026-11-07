<script setup lang="ts">
// The evening review (LDJ-26): one short screen, tomorrow's intention and your top dream sign. "Done" ticks the habit.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { tonightNight, tickPractice } from "../../api/train";
import { useChange } from "../../api/queries";
import { useHabits } from "./useHabits";

const router = useRouter();
const h = useHabits();
const intention = computed(() => tonightNight(h.j.nights.data.value)?.intention?.trim() || "");
const done = useChange(async () => { await tickPractice("habit:review", h.today.value, true, h.rowOf("habit:review")); router.push("/train"); }, ["practice"]);
</script>

<template>
  <div class="tview">
    <div class="ph"><div><h1>Evening review</h1></div><div class="acts"><button class="btn s keep" :disabled="done.busy.value" @click="done.run()">Done</button></div></div>
    <div class="card">
      <div class="s tiny">Tomorrow's intention</div>
      <div class="t">{{ intention || "None set. Open a technique such as MILD and choose Use tonight to plan one." }}</div>
      <div class="s tiny hrv">Your top dream sign</div>
      <div v-if="h.topSign.value" class="t"><router-link :to="'/signs/' + h.topSign.value.id">{{ h.topSign.value.name }}</router-link></div>
      <div v-else class="t">None yet. Dream signs appear as you log dreams.</div>
    </div>
    <router-link to="/train" class="lnk inl tiny">Back to Train</router-link>
  </div>
</template>
