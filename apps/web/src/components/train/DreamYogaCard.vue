<script setup lang="ts">
// Dream yoga daytime practices (optional feature, LDJ-26): Wangyal's four foundational practices, each a tickable daily
// habit. Shown as a tradition, not a scientific claim (RESEARCH.md Part D, 5.2; source [28]).
import { DREAM_YOGA_PRACTICES, habitStreak } from "@somnium/shared";
import { tickPractice } from "../../api/train";
import { toastError } from "../../core/toast";
import { useHabits } from "./useHabits";

const h = useHabits();
const toggle = (id: string) => tickPractice(id, h.today.value, !h.rowOf(id), h.rowOf(id)).catch(toastError);
</script>

<template>
  <section class="tyoga">
    <div class="sh"><h3 class="lbl">Dream yoga</h3></div>
    <div class="card flush">
      <label v-for="p in DREAM_YOGA_PRACTICES" :key="p.id" class="li tdtick">
        <!-- the box follows the stored tick, so a failed write never leaves it showing the wrong state -->
        <input type="checkbox" :checked="!!h.rowOf(p.id)" @click.prevent="toggle(p.id)" />
        <div class="grow"><div class="t">{{ p.name }} · {{ p.when }}</div><div class="tiny">{{ p.text }}</div></div>
        <span v-if="habitStreak(h.rows.value, p.id, h.today.value)" class="tiny num">{{ habitStreak(h.rows.value, p.id, h.today.value) }}d</span>
      </label>
    </div>
    <p class="tiny">A tradition, not a scientific claim: Tenzin Wangyal Rinpoche's four foundational practices ("the Four Preparations") from <i>The Tibetan Yogas of Dream and Sleep</i> (1998).</p>
  </section>
</template>
