<script setup lang="ts">
// Streaks and rates (PLAN.md §6.1, §7.3): three small numbers, no charts. Plans never count as logged nights.
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
      <div><div class="tiny">Lucid this month</div><div class="hv num">{{ rates.lucidThisMonth }}</div><div class="tiny">{{ rates.lucidThisMonth === 1 ? "dream" : "dreams" }}</div></div>
    </div>
  </section>
</template>
