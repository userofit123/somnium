<script setup lang="ts">
// A milestone's one calm moment (LDJ-117), shown in the editor right after the dream is saved: the first lucid dream,
// the first from a technique, the first clear one. A card in the editor, never a toast or notification, so the lock
// takes it away with the editor. It says what it means, what made it happen when the dream says so, and the first
// seconds to practise next time, because excitement wakes most new lucid dreamers (RESEARCH.md D1 ch. 6, D5 Unit 5).
// Being shown is recorded by the editor (settings.milestones), so it never comes again.
import { ref } from "vue";
import { MILESTONE_TEXT, NEXT_TIME, NEXT_TIME_SOURCES, STABILISE_LESSON, type MilestoneId } from "@somnium/shared";
import CiteChips from "../learn/CiteChips.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import "../../styles/components/learn.css";

defineProps<{
  id: MilestoneId;
  /** how they knew, as a sentence (MILESTONE_HOW); what tipped them off, in their own words */
  how?: string | null; trigger?: string | null;
  /** the night's techniques, as labels */
  recipe: string[];
}>();
const emit = defineEmits<{ lesson: [] }>();
const open = ref<string[] | null>(null);
</script>

<template>
  <section class="card jms" aria-labelledby="jms-t">
    <h2 id="jms-t" class="jms-t">{{ MILESTONE_TEXT[id].title }}</h2>
    <p class="jms-l">{{ MILESTONE_TEXT[id].line }} <CiteChips :ids="MILESTONE_TEXT[id].sources" @cite="open = $event" /></p>
    <p v-if="how || trigger || recipe.length" class="jms-why">
      <template v-if="how">{{ how }}.</template>
      <template v-if="trigger"> What tipped you off: "{{ trigger }}".</template>
      <template v-if="recipe.length"> That night: {{ recipe.join(" · ") }}.</template>
    </p>
    <p class="jms-next">{{ NEXT_TIME }} <CiteChips :ids="NEXT_TIME_SOURCES" @cite="open = $event" /></p>
    <router-link :to="STABILISE_LESSON" class="lnk" @click="emit('lesson')">Open the lesson on staying lucid</router-link>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
</template>

<style scoped>
.jms { display: flex; flex-direction: column; gap: calc(var(--hg) / 2); border-left: 2px solid var(--acc); }
.jms-t { margin: 0; font-size: var(--fs-lg); font-weight: 600; color: var(--tx); }
.jms p { margin: 0; line-height: 1.5; }
.jms-l { color: var(--tx); }
.jms-why { color: var(--tx2); }
.jms-next { color: var(--tx); }
.jms .lnk { align-self: flex-start; }
</style>
