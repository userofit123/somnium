<script setup lang="ts">
// Day notes and dreams (optional, LDJ-41): which things you wrote about came back in a dream 1-2 or 5-7 days later,
// counted here from the notes and elements on this device (packages/shared/src/lag.ts). Honest wording: counts with
// the chance level beside them, never "caused". Only shown while Settings → Features → Day notes is on.
import { computed, ref } from "vue";
import { LAG_CAVEAT, LAG_LABEL, LAG_SOURCES, LAG_MIN_MENTIONS, RESIDUE_LABEL, lagAnalysis, lagLine } from "@somnium/shared";
import { useJournal } from "../../api/journal";
import { useDayNotes } from "../../api/extras";
import SourceSheet from "../learn/SourceSheet.vue";
import Icon from "../Icon.vue";
import Sheet from "../Sheet.vue";
import "../../styles/components/learn.css";

const props = defineProps<{ today: string }>();
const j = useJournal();
const notes = useDayNotes();
const rows = computed(() => lagAnalysis(notes.data.value ?? [], j.elements.data.value ?? [], j.links.data.value ?? [], j.facts.data.value ?? [], props.today).filter((r) => r.enough).slice(0, 6));
// the long caveat sits behind the info button, as on the themes card
const about = ref(false);
const open = ref<string[] | null>(null);
const count = computed(() => (notes.data.value ?? []).filter((n) => n.text).length);
</script>

<template>
  <section data-testid="lagcard">
    <div class="sh"><h2>Day notes and dreams</h2><button class="ib sm plain" type="button" aria-label="About these counts" @click="about = true"><Icon name="info" :size="17" /></button></div>
    <div class="card">
      <div v-if="!rows.length" class="empty sm"><b>Not enough yet</b>{{ count }} day {{ count === 1 ? "note" : "notes" }} so far. An element needs to be named in at least {{ LAG_MIN_MENTIONS }} notes before it shows here.</div>
      <div v-for="r in rows" :key="r.elementId" class="ins-lag">
        <div class="t">{{ r.name }} <span class="tiny">named on {{ r.days }} days</span></div>
        <div class="tiny">{{ lagLine(r.residue, RESIDUE_LABEL) }}</div>
        <div class="tiny">{{ lagLine(r.lag, LAG_LABEL) }}</div>
      </div>
      <div class="tiny ins-note">Sources: Nielsen and Powell 1989 · Nielsen and others 2004 · Blagrove and others 2011 <button v-for="id in LAG_SOURCES" :key="id" type="button" class="cite" :aria-label="'Source ' + id" @click="open = [id]">{{ id }}</button></div>
    </div>
    <Sheet v-if="about" title="Day notes and dreams" @close="about = false"><p>{{ LAG_CAVEAT }}</p></Sheet>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
</template>

<style>
.ins-lag { display: grid; gap: 2px; padding-block: var(--s1, 4px); }
</style>
