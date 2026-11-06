<script setup lang="ts">
// The quiet sleep-safety note on the WBTB, WILD and SSILD pages and lessons (RESEARCH.md Part B §6.2-6.3).
import { parseInline } from "@somnium/knowledge/markdown";
import { safetyLines } from "@somnium/knowledge/techniques";
import LearnInline from "../learn/LearnInline.vue";
const emit = defineEmits<{ cite: [ids: string[]] }>();
const lines = safetyLines.map((l) => parseInline(l));
</script>

<template>
  <aside class="tsafe" aria-label="Sleep and safety">
    <div class="tiny"><b>Sleep and safety</b></div>
    <ul><li v-for="(l, i) in lines" :key="i" class="tiny"><LearnInline :nodes="l" @cite="emit('cite', $event)" /></li></ul>
    <router-link to="/learn/safety/who-should-be-careful" class="lnk inl tiny">More in Learn</router-link>
  </aside>
</template>
