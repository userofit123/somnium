<script setup lang="ts">
// Daily habits (LDJ-26, PLAN.md §6.4): the four-item checklist with a streak for each and for "days with all done".
// The journal and reality-check items tick themselves from the day's own data (a row is written once, when the
// condition is first true); the sign item ticks when its page is opened; the evening review has its own short screen.
import { computed, watch } from "vue";
import { CORE_HABITS, allDoneStreak, habitStreak } from "@somnium/shared";
import { tickPractice } from "../../api/train";
import { toastError } from "../../core/toast";
import { useHabits } from "./useHabits";
import Icon from "../Icon.vue";

const h = useHabits();
const tickToday = (id: string, on = true) => tickPractice(id, h.today.value, on, h.rowOf(id)).catch(toastError);

// automatic ticks: only ever on, once the lists are in; a flag per day and item stops a second write while the first is in flight
const sent = new Set<string>();
watch([h.ready, h.wroteToday, h.checksToday, h.checkTarget, h.today], () => {
  if (!h.ready.value) return;
  const want: [string, boolean][] = [["habit:journal", h.wroteToday.value], ["habit:checks", h.checksToday.value >= h.checkTarget.value]];
  for (const [id, ok] of want) {
    const key = h.today.value + id;
    if (ok && !h.rowOf(id) && !sent.has(key)) { sent.add(key); void tickToday(id); }
  }
}, { immediate: true });

const items = computed(() => CORE_HABITS.map((c) => {
  const streak = habitStreak(h.rows.value, c.id, h.today.value);
  const detail = c.id === "habit:checks" ? `${h.checksToday.value} of ${h.checkTarget.value} today` : c.id === "habit:sign" && h.topSign.value ? h.topSign.value.name : c.auto;
  return { ...c, on: !!h.rowOf(c.id), streak, detail };
}));
const all = computed(() => allDoneStreak(h.rows.value, h.today.value));
const done = computed(() => items.value.filter((i) => i.on).length);
const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);
</script>

<template>
  <section class="thabits">
    <div class="sh"><h2>Today's habits</h2><span class="tiny">{{ done }} of {{ items.length }}</span></div>
    <div class="card flush">
      <div v-for="i in items" :key="i.id" class="li hrow">
        <span class="hbox" :class="{ on: i.on }" aria-hidden="true"><Icon v-if="i.on" name="check" :size="14" /></span>
        <router-link v-if="i.id === 'habit:review'" to="/train?review=1" class="grow hl"><div class="t">{{ i.name }}</div><div class="tiny">{{ i.detail }}</div></router-link>
        <router-link v-else-if="i.id === 'habit:sign'" :to="h.topSign.value ? '/signs/' + h.topSign.value.id : '/signs'" class="grow hl" @click="tickToday(i.id)"><div class="t">{{ i.name }}</div><div class="tiny">{{ i.detail }}</div></router-link>
        <div v-else class="grow"><div class="t">{{ i.name }}</div><div class="tiny">{{ i.detail }}</div></div>
        <span v-if="i.streak" class="tiny hstreak num">{{ days(i.streak) }}</span>
      </div>
    </div>
    <p class="tiny hall">Days with all four done in a row: <b class="num">{{ all }}</b></p>
  </section>
</template>
