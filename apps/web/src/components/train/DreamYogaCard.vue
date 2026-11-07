<script setup lang="ts">
// Dream yoga daytime practices (optional feature, LDJ-26): Wangyal's four foundational practices, each a tickable daily
// habit. Shown as a tradition, not a scientific claim (RESEARCH.md Part D, 5.2; source [28]).
import { DREAM_YOGA_PRACTICES, habitStreak } from "@somnium/shared";
import { tickPractice } from "../../api/train";
import { toastError } from "../../core/toast";
import { useHabits } from "./useHabits";
import Icon from "../Icon.vue";

const h = useHabits();
const toggle = (id: string) => tickPractice(id, h.today.value, !h.rowOf(id), h.rowOf(id)).catch(toastError);
</script>

<template>
  <section class="tyoga">
    <div class="sh"><h2>Dream yoga</h2></div>
    <div class="card flush">
      <div v-for="p in DREAM_YOGA_PRACTICES" :key="p.id" class="li">
        <button type="button" class="tck grow" :class="{ on: !!h.rowOf(p.id) }" :aria-pressed="!!h.rowOf(p.id)" @click="toggle(p.id)">
          <span class="box"><Icon v-if="h.rowOf(p.id)" name="check" :size="14" /></span>
          <span class="txt"><b>{{ p.name }}</b> · {{ p.when }}<br />{{ p.text }}</span>
        </button>
        <span v-if="habitStreak(h.rows.value, p.id, h.today.value)" class="tiny num">{{ habitStreak(h.rows.value, p.id, h.today.value) }}d</span>
      </div>
    </div>
    <p class="tiny">A tradition, not a scientific claim: Tenzin Wangyal Rinpoche's four foundational practices ("the Four Preparations") from <i>The Tibetan Yogas of Dream and Sleep</i> (1998).</p>
  </section>
</template>
