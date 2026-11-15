<script setup lang="ts">
// "In this dream" (LDJ-110): right after a dream is written, the dream signs it holds. The person's own signs that
// came back, with their count and whether one came with lucidity before, and up to three sign-like things the app found
// (odd forms, impossible actions, things out of place) to mark, each with the check to do next time. LaBerge's
// dreamsign inventory: collect, mark, count, target the most frequent (RESEARCH.md C1, C2). Read on this device; the
// editor does the marking. Shown inside the editor only, so the lock takes it away with it.
import { ref } from "vue";
import { SIGN_ADVICE_SOURCES } from "@somnium/shared";
import CiteChips from "../learn/CiteChips.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import "../../styles/components/learn.css";

export interface InDreamRow {
  key: string; name: string;
  /** one of their signs already: the dreams it has been in, this one included */
  seen?: number;
  lucidBefore?: boolean;
  /** the paired reality check's name */
  check: string | null;
  marked: boolean;
}
defineProps<{ rows: InDreamRow[] }>();
const emit = defineEmits<{ mark: [key: string] }>();
const open = ref<string[] | null>(null);
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
</script>

<template>
  <section class="card jid" aria-labelledby="jid-t">
    <h2 id="jid-t" class="jid-t">In this dream</h2>
    <p class="tiny jid-sub">Dream signs are the odd things that keep coming back. Spotting them here helps you notice them inside the dream. <CiteChips :ids="SIGN_ADVICE_SOURCES" @cite="open = $event" /></p>
    <ul class="jid-list">
      <li v-for="r in rows" :key="r.key" class="jid-row">
        <div class="jid-main">
          <div class="jid-name">{{ r.name }}</div>
          <div v-if="r.seen" class="tiny jid-meta">Already one of your dream signs · seen {{ times(r.seen) }}</div>
          <div v-if="r.lucidBefore" class="tiny jid-meta">You became lucid with this one before</div>
          <div v-if="(r.seen || r.marked) && r.check" class="tiny jid-next">Next time: {{ r.check }}</div>
        </div>
        <button v-if="!r.seen && !r.marked" type="button" class="btn o s" @click="emit('mark', r.key)">Mark as dream sign</button>
        <span v-else-if="r.marked" class="tiny jid-done">Marked</span>
      </li>
    </ul>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
</template>

<style scoped>
.jid { display: flex; flex-direction: column; gap: var(--tdy); }
.jid-t { margin: 0; font-size: var(--fs-lg); font-weight: 600; color: var(--tx); }
.jid-sub { margin: 0; color: var(--tx2); }
.jid-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.jid-row { display: flex; align-items: center; gap: var(--lpy); padding: var(--tdy) 0; }
.jid-row + .jid-row { border-top: 1px solid var(--ol); }
.jid-main { flex: 1; min-width: 0; }
.jid-name { color: var(--tx); font-weight: 500; overflow-wrap: anywhere; }
.jid-meta { color: var(--tx2); }
.jid-next { color: var(--acc); }
.jid-done { color: var(--tx2); }
</style>
