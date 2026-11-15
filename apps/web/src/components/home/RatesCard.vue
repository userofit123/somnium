<script setup lang="ts">
// Streaks and rates (PLAN.md §6.1, §7.3): three small numbers, no charts. Plans never count as logged nights.
// Under them one quiet line on recall now against the start (LDJ-199), linking to Progress, once there is one.
import { computed } from "vue";
import { recallLine, type HomeRates } from "@somnium/shared";
const props = defineProps<{ rates: HomeRates }>();
const recall = computed(() => recallLine(props.rates.recall));
</script>

<template>
  <section class="hrates">
    <div class="sh"><h2>Streaks and rates</h2></div>
    <div class="card hnums">
      <div><div class="tiny">Journal streak</div><div class="hv num">{{ rates.streak }}</div><div class="tiny">{{ rates.streak === 1 ? "morning" : "mornings" }}</div></div>
      <div><div class="tiny">Recall, {{ rates.recall.days }} nights</div><div class="hv num">{{ recall.value }}</div><div class="tiny">{{ recall.sub }}</div></div>
      <div><div class="tiny">Lucid dreams this month</div><div class="hv num">{{ rates.lucidThisMonth }}</div><div class="tiny">{{ rates.lucidThisMonth === 1 ? "dream" : "dreams" }}, naps too</div></div>
      <router-link v-if="rates.recallChange" to="/progress" class="hrecall tiny"><b>Your recall</b> · {{ rates.recallChange }}</router-link>
    </div>
  </section>
</template>

<style scoped>
/* the full width of the three numbers' grid, set off by the card's own divider */
.hrecall { grid-column: 1 / -1; padding-top: var(--hg); border-top: 1px solid var(--ol); color: var(--tx2); text-decoration: none; }
.hrecall b { color: var(--acc); font-weight: 600; }
</style>
