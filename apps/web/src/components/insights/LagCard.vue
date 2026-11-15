<script setup lang="ts">
// Day notes and dreams (optional, LDJ-41): which things you wrote about came back in a dream 1-2 or 5-7 days later,
// counted here from the notes and elements on this device (packages/shared/src/lag.ts). Honest wording: counts with
// the chance level beside them, never "caused". Only shown while Settings → Features → Day notes is on.
import { computed, ref } from "vue";
import { LAG_LABEL, LAG_SOURCES, LAG_MIN_MENTIONS, RESIDUE_LABEL, lagAnalysis, lagLine } from "@somnium/shared";
import { useJournal } from "../../api/journal";
import { useDayNotes } from "../../api/extras";
import SourceSheet from "../learn/SourceSheet.vue";
import CiteChips from "../learn/CiteChips.vue";
import ChartInfo from "./ChartInfo.vue";
import "../../styles/components/learn.css";

const props = defineProps<{ today: string }>();
const j = useJournal();
const notes = useDayNotes();
const rows = computed(() => lagAnalysis(notes.data.value ?? [], j.elements.data.value ?? [], j.links.data.value ?? [], j.facts.data.value ?? [], props.today).filter((r) => r.enough).slice(0, 6));
const open = ref<string[] | null>(null);
const count = computed(() => (notes.data.value ?? []).filter((n) => n.text).length);
</script>

<template>
  <section data-testid="lagcard">
    <div class="sh"><h2>Day notes and dreams</h2><ChartInfo id="day-notes" /></div>
    <div class="card">
      <div v-if="!rows.length" class="empty sm"><b>Not enough yet</b>{{ count }} day {{ count === 1 ? "note" : "notes" }} so far. An element needs to be named in at least {{ LAG_MIN_MENTIONS }} notes before it shows here.</div>
      <div v-for="r in rows" :key="r.elementId" class="ins-lag">
        <div class="t">{{ r.name }} <span class="tiny">named on {{ r.days }} days</span></div>
        <div class="tiny">{{ lagLine(r.residue, RESIDUE_LABEL) }}</div>
        <div class="tiny">{{ lagLine(r.lag, LAG_LABEL) }}</div>
      </div>
      <div class="tiny ins-note">Sources: Nielsen and Powell 1989 · Nielsen and others 2004 · Blagrove and others 2011 <CiteChips :ids="LAG_SOURCES" @cite="open = $event" /></div>
    </div>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
</template>

<style>
.ins-lag { display: grid; gap: 2px; padding-block: var(--s1, 4px); }
</style>
