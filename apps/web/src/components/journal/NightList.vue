<script setup lang="ts">
// Nights newest first, each with its dreams: their marks (lucid, nightmare or bad dream, recurring, false awakening,
// on one line that ends in "..." when it runs out of room), favourite, and how many elements.
// A night without dreams is a night logged with no recall.
import { dreamListMarks, type NightGroup } from "@somnium/shared";
import type { DreamRow, NightRow } from "../../api/journal";
import { useFmt } from "../../core/format";
import Icon from "../Icon.vue";

// bare: without the date headings (the calendar's day already says which night)
defineProps<{ groups: NightGroup<NightRow, DreamRow>[]; counts: Map<string, number>; selected?: string; bare?: boolean }>();
const emit = defineEmits<{ open: [id: string] }>();
const fmt = useFmt();
const label = (d: DreamRow) => d.title?.trim() || d.text?.trim().slice(0, 90) || "Untitled dream";
const sub = (d: DreamRow, els: number) => [...dreamListMarks(d), els ? `${els} element${els === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "Dream";
</script>

<template>
  <section v-for="g in groups" :key="g.night.id">
    <div v-if="!bare" class="sh"><h2>{{ fmt.date(g.night.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) }}</h2><span class="tiny">{{ g.night.nap ? "Nap" : g.dreams.length ? (g.dreams.length === 1 ? "1 dream" : `${g.dreams.length} dreams`) : "" }}</span></div>
    <div class="card jnc" :class="{ b: bare }"><div class="list">
      <div v-if="!g.dreams.length" class="li"><Icon name="moon" :size="18" class="jmut" /><div class="grow"><div class="t jmut">No recall</div></div></div>
      <button v-for="d in g.dreams" :key="d.id" class="li click jrow" :class="{ on: selected === d.id }" :aria-current="(selected === d.id) || undefined" @click="emit('open', d.id)">
        <Icon :name="d.lucid ? 'sparkle' : 'book'" :size="18" :class="d.lucid ? 'jacc' : 'jmut'" />
        <div class="grow jmin"><div class="t ellipsis">{{ label(d) }}</div><div class="s ellipsis">{{ sub(d, counts.get(d.id) ?? 0) }}</div></div>
        <span class="r jmk"><Icon v-if="d.nightmare" name="flame" :size="16" class="jneg" :aria-label="'Nightmare'" /><Icon v-if="d.favourite" name="star" :size="16" class="jacc" :aria-label="'Favourite'" /></span>
      </button>
    </div></div>
  </section>
</template>

<style scoped>
section + section .jnc.b { margin-top: var(--hg); }
.jrow { width: 100%; background: none; border-left: 0; border-right: 0; border-top: 0; color: var(--tx); text-align: start; font: inherit; cursor: pointer; }
.jrow.on { background: var(--s2); }
.jmin { min-width: 0; }
.jmk { display: inline-flex; gap: 4px; }
.jacc { color: var(--acc); }
.jneg { color: var(--neg); }
.jmut { color: var(--tx2); }
</style>
