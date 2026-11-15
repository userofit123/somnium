<script setup lang="ts">
// The info button on a Progress section header and its "What this shows" sheet (LDJ-156): what the numbers are,
// how to read them (typical values from the research), one thing to do, and the sources. One pattern for every
// section; the texts are packages/knowledge/content/progress/<id>.md, reviewed and cited like Learn. The numbers the
// code sets (nights before a rate shows) are filled in here from the same constants the sums use.
import { computed, ref } from "vue";
import {
  MIN_NIGHTS, RECALL_TARGETS, RECALL_WINDOW, RECALL_MIN_NIGHTS, QUALITY_MIN, SLEEP_MIN_NIGHTS, LAG_MIN_MENTIONS, THEMES_MIN_DREAMS,
} from "@somnium/shared";
import { chartHelp, chartHelpParts, fillHelp, type ChartHelpId, type ChartHelpVar } from "@somnium/knowledge/chartHelp";
import { parseMarkdown } from "@somnium/knowledge/markdown";
import Icon from "../Icon.vue";
import Sheet from "../Sheet.vue";
import LearnBlocks from "../learn/LearnBlocks.vue";
import CiteChips from "../learn/CiteChips.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import "../../styles/components/learn.css";

const props = defineProps<{ id: ChartHelpId }>();
// every placeholder a note may use; the Record type makes a new one a type error until it is filled in here
const VARS: Record<ChartHelpVar, string | number> = {
  MIN_NIGHTS, RECALL_RUN: RECALL_TARGETS.run, RECALL_PER_NIGHT: RECALL_TARGETS.perNight, RECALL_WINDOW, RECALL_MIN_NIGHTS,
  QUALITY_MIN, SLEEP_MIN_NIGHTS, LAG_MIN_MENTIONS, THEMES_MIN_DREAMS,
};
const help = computed(() => chartHelp.get(props.id));
const parts = computed(() => (help.value ? chartHelpParts.map((p) => ({ ...p, blocks: parseMarkdown(fillHelp(help.value!.parts[p.key], VARS)) })) : []));
const open = ref(false);
// a source opens over the note, so closing it lands back on the note
const sources = ref<string[] | null>(null);
</script>

<template>
  <button v-if="help" class="ib sm plain" type="button" :aria-label="`What ${help.title.toLowerCase()} shows`" :data-help="id" @click="open = true"><Icon name="info" :size="17" /></button>
  <Sheet v-if="open && help" :title="help.title" @close="open = false">
    <div class="chelp">
      <div v-for="p in parts" :key="p.key">
        <div class="lbl hgap">{{ p.heading }}</div>
        <LearnBlocks :blocks="p.blocks" @cite="sources = $event" />
      </div>
      <div><div class="lbl hgap">Sources</div><CiteChips :ids="help.sources" @cite="sources = $event" /></div>
    </div>
  </Sheet>
  <SourceSheet v-if="sources" :ids="sources" @close="sources = null" />
</template>

<style scoped>
.chelp { display: grid; gap: var(--spg); }
</style>
