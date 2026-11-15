<script setup lang="ts">
// Streaks and rates (PLAN.md §6.1, §7.3): three small numbers, no charts. Plans never count as logged nights.
// Under them one quiet line on recall now against the start (LDJ-199), linking to Progress, once there is one.
import { computed } from "vue";
import Icon from "../Icon.vue";
import { recallLine, type HomeRates } from "@somnium/shared";
const props = defineProps<{ rates: HomeRates }>();
const recall = computed(() => recallLine(props.rates.recall));
</script>

<template>
  <section class="hrates">
    <div class="sh"><h2>Your streaks</h2><router-link to="/progress" class="lnk">Progress<Icon name="right" :size="14" /></router-link></div>
    <div class="grid g3 keep">
      <div class="card hero stat"><div class="lbl"><span class="bi"><Icon name="flame" :size="15" /></span>Streak</div><div class="val num">{{ rates.streak }}</div><div class="sub">{{ rates.streak === 1 ? "morning" : "mornings" }} logged</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="moon" :size="15" /></span>Recall</div><div class="val num">{{ recall.value }}</div><div class="sub">{{ recall.sub }}, {{ rates.recall.days }} days</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="sparkle" :size="15" /></span>Lucid</div><div class="val num">{{ rates.lucidThisMonth }}</div><div class="sub">{{ rates.lucidThisMonth === 1 ? "dream" : "dreams" }} this month</div></div>
    </div>
    <router-link v-if="rates.recallChange" to="/progress" class="hrecall tiny"><b>Your recall</b> · {{ rates.recallChange }}</router-link>
  </section>
</template>

<style scoped>
/* under the tiles, one quiet line */
.hrecall { display: block; margin-top: var(--lpy); color: var(--tx2); text-decoration: none; }
.hrecall b { color: var(--acc); font-weight: 600; }
</style>
