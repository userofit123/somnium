<script lang="ts">
// A calm note for the experiences most likely to frighten a beginner off (LDJ-158): sleep paralysis, a false
// awakening, a nightmare or bad dream. What it is, what helps, and when to talk to someone, each sentence cited from
// the safety and nightmare articles it links to (RESEARCH.md Part D §4.5). The editor shows the full note when a
// mark is turned on; the dream page shows one line each. Only in the page itself, so the lock takes it away too.
export type HardKind = "sleepParalysis" | "falseAwakening" | "nightmare";
type Line = { text: string; sources: readonly string[] };
export const HARD_NOTES: Record<HardKind, { title: string; lines: Line[]; help: Line; short: Line; article: string; more: string }> = {
  sleepParalysis: {
    title: "Sleep paralysis",
    lines: [
      { text: "It is common and harmless. It is the same stillness that keeps you from acting out every dream, lasting for a moment after you wake.", sources: ["B4", "B6", "D1"] },
      { text: "To end it, don't fight it. Relax, breathe slowly, remember it is only the dreaming state, and move one finger or toe.", sources: ["D1", "D5"] },
      { text: "Broken-up sleep, such as waking early to practise, makes it more likely.", sources: ["B6", "B7"] },
    ],
    help: { text: "If it comes often and frightens you, pause the night techniques and talk to a doctor.", sources: ["B70", "B71"] },
    short: { text: "Sleep paralysis is common and harmless. Relax, breathe and move one finger to end it.", sources: ["B6", "D1"] },
    article: "/learn/safety/false-awakenings-and-sleep-paralysis",
    more: "Read about sleep paralysis",
  },
  falseAwakening: {
    title: "False awakening",
    lines: [
      { text: "Dreaming that you woke up is common among people who practise lucid dreaming, and it often turns into a lucid dream.", sources: ["B8"] },
      { text: "Treat it as a chance: do a reality check every time you wake, such as trying a light switch or looking at a clock.", sources: ["C4", "D1", "D19"] },
    ],
    help: { text: "If dreams and waking life start to blur, pause the practice and talk to someone.", sources: ["B70", "B71"] },
    short: { text: "A false awakening is a chance to become lucid. Do a reality check every time you wake.", sources: ["B8", "D19"] },
    article: "/learn/safety/false-awakenings-and-sleep-paralysis",
    more: "Read about false awakenings",
  },
  nightmare: {
    title: "A frightening dream",
    lines: [
      { text: "Nothing in a dream can hurt you. If you become lucid, you can stay and face what frightens you, or ask it what it wants; a calm talk works better than a fight.", sources: ["D1", "D10"] },
      { text: "Awake, you can rewrite it: choose a new ending and picture the dream with it. This is imagery rehearsal, the best-proven help for nightmares.", sources: ["B57", "B61", "B63"] },
    ],
    help: { text: "If nightmares wake you several times a week, or come after something hard such as a loss or trauma, talk to a doctor or therapist before starting the night techniques.", sources: ["B60", "B69", "B73"] },
    short: { text: "Nothing in a dream can hurt you, and a nightmare can be rewritten while awake.", sources: ["D1", "B61"] },
    article: "/learn/benefits/nightmares",
    more: "Read about nightmares",
  },
};
</script>

<script setup lang="ts">
import { ref } from "vue";
import CiteChips from "../learn/CiteChips.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import "../../styles/components/learn.css";

const props = defineProps<{ kinds: readonly HardKind[]; short?: boolean }>();
// learn: the link was followed, so the editor can close itself the way it does for a milestone's lesson
const emit = defineEmits<{ learn: [] }>();
const open = ref<string[] | null>(null);
</script>

<template>
  <section v-if="props.short" class="card hnote" aria-label="What helps">
    <p v-for="k in kinds" :key="k" class="hn-l">{{ HARD_NOTES[k].short.text }} <CiteChips :ids="HARD_NOTES[k].short.sources" @cite="open = $event" />
      <router-link :to="HARD_NOTES[k].article" class="lnk">{{ HARD_NOTES[k].more }}</router-link></p>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
  <template v-else>
    <section v-for="k in kinds" :key="k" class="card hnote" :aria-labelledby="'hn-' + k" aria-live="polite">
      <h2 :id="'hn-' + k" class="hn-t">{{ HARD_NOTES[k].title }}</h2>
      <p v-for="(l, i) in HARD_NOTES[k].lines" :key="i" class="hn-l">{{ l.text }} <CiteChips :ids="l.sources" @cite="open = $event" /></p>
      <p class="hn-h">{{ HARD_NOTES[k].help.text }} <CiteChips :ids="HARD_NOTES[k].help.sources" @cite="open = $event" /></p>
      <router-link :to="HARD_NOTES[k].article" class="lnk" @click="emit('learn')">{{ HARD_NOTES[k].more }}</router-link>
    </section>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </template>
</template>

<style scoped>
.hnote { display: flex; flex-direction: column; gap: var(--tdy); }
.hnote p { margin: 0; line-height: 1.5; }
.hn-t { margin: 0; font-size: inherit; font-weight: 600; color: var(--tx); }
.hn-l { color: var(--tx); }
.hn-h { color: var(--tx2); }
.hnote .lnk { align-self: flex-start; }
.hn-l .lnk { margin-left: var(--tdy); }
</style>
