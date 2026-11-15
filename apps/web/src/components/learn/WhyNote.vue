<script setup lang="ts">
// A first-time "why this works" note (LDJ-157): the first time someone uses a practice screen, one or two calm
// sentences in place say why its steps are what they are, with the sources as chips and "Read more" into the Learn
// article that holds the evidence. "Got it" puts it away for good on this device, per account (core/seenOnDevice.ts).
// Texts: packages/knowledge/content/why. Never a toast, and nothing while the app is locked: the check screen opens
// over the lock screen, so there the note waits until the journal is opened.
import { computed, ref } from "vue";
import { whyNotes, type WhyNoteId } from "@somnium/knowledge/whyNotes";
import { lock } from "../../core/lock";
import { readWhySeen, rememberWhySeen } from "../../core/seenOnDevice";
import CiteChips from "./CiteChips.vue";
import SourceSheet from "./SourceSheet.vue";
import "../../styles/components/learn.css";

const props = defineProps<{ id: WhyNoteId }>();
const note = computed(() => whyNotes.get(props.id));
const seen = ref(readWhySeen().includes(props.id));
const show = computed(() => !!note.value && !seen.value && !lock.locked);
const open = ref<string[] | null>(null);
function gotIt() { rememberWhySeen(props.id); seen.value = true; }
</script>

<template>
  <aside v-if="show && note" class="why" :aria-labelledby="'why-' + id">
    <div :id="'why-' + id" class="why-t">{{ note.title }}</div>
    <p class="why-x">{{ note.text }} <CiteChips :ids="note.sources" @cite="open = $event" /></p>
    <div class="why-a">
      <router-link :to="'/learn/' + note.more" class="why-l">Read more</router-link>
      <button type="button" class="why-l" @click="gotIt">Got it</button>
    </div>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </aside>
</template>

<style scoped>
.why { display: flex; flex-direction: column; gap: var(--tdy); padding: var(--cpy) var(--cpx); border-radius: var(--r); background: var(--s2); color: var(--tx); text-align: start; }
.why-t { font-weight: 600; }
.why-x { margin: 0; line-height: 1.5; color: var(--tx2); }
.why-a { display: flex; justify-content: flex-end; gap: var(--lpy); flex-wrap: wrap; }
.why-l { background: none; border: 0; padding: var(--tdy) 0; font: inherit; font-size: var(--fs-sm); font-weight: 600; color: var(--acc); cursor: pointer; text-decoration: none; }
/* on the dim night surface of the guided screens and the morning capture */
:global(.gd) .why { background: var(--sdim2); color: var(--sdimtx); }
:global(.gd) .why-x { color: var(--sdimtx2); }
:global(.gd) .why-l { color: var(--gacc); }
</style>
