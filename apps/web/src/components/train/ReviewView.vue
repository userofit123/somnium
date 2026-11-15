<script setup lang="ts">
// The evening review (LDJ-26): one short screen, tomorrow's intention and your top dream sign. "Done" ticks the habit.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { eveningOf } from "@somnium/shared";
import { tonightNight, tickPractice } from "../../api/train";
import { useChange } from "../../api/queries";
import { goBack, backLabel } from "../../core/leave";
import Icon from "../Icon.vue";
import { useHabits } from "./useHabits";

const router = useRouter();
const h = useHabits();
const intention = computed(() => tonightNight(h.j.nights.data.value)?.intention?.trim() || "");
// Back and Done return to where the review was opened from (Train's checklist, Home); opened directly, to Train
const back = backLabel(router, "Train");
// the review belongs to the evening the night began: done at 01:00, it ticks yesterday's (as Home's step reads it)
const done = useChange(async () => {
  const evening = eveningOf(h.today.value, new Date().getHours());
  await tickPractice("habit:review", evening, true, h.rowAt("habit:review", evening));
  goBack(router, "/train");
}, ["practice"]);
</script>

<template>
  <div class="tview">
    <div class="ph"><div><button type="button" class="back" @click="goBack(router, '/train')"><Icon name="left" :size="16" /><span>{{ back }}</span></button><h1>Evening review</h1></div><div class="acts"><button class="btn s keep" :disabled="done.busy.value" @click="done.run()">Done</button></div></div>
    <div class="card">
      <div class="s tiny">Tomorrow's intention</div>
      <div class="t">{{ intention || "None set. Open a technique such as MILD and choose Use tonight to plan one." }}</div>
      <div class="s tiny hrv">Your top dream sign</div>
      <div v-if="h.topSign.value" class="t"><router-link :to="'/signs/' + h.topSign.value.id">{{ h.topSign.value.name }}</router-link></div>
      <div v-else class="t">None yet. Dream signs appear as you log dreams.</div>
    </div>
  </div>
</template>
