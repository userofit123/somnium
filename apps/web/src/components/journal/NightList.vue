<script setup lang="ts">
// Nights newest first, each with its dreams: their marks (lucid, nightmare or bad dream, recurring, false awakening,
// on one line that ends in "..." when it runs out of room), favourite, and how many elements.
// A night without dreams is a night logged with no recall. Each night opens its Night details from its own row (LDJ-99):
// bedtime, wake time and techniques on one line, or the invitation to add them.
// A dream the morning capture saved as key words carries a quiet "Finish writing" (LDJ-162), and its tap opens it to
// write rather than to read, so finishing it is one tap (RESEARCH.md C1, C2).
// Day notes (optional, LDJ-123) show inside their day, after that date's night: a day with a note and no night logged
// gets a section of its own. A note still kept sealed on this device (offline) shows as waiting.
import { computed } from "vue";
import { dreamListMarks, nightLine, type DayNote, type NightGroup } from "@somnium/shared";
import type { DreamRow, NightRow } from "../../api/journal";
import { useFmt } from "../../core/format";
import Icon from "../Icon.vue";

// bare: without the date headings (the calendar's day already says which night)
// notes: the day notes to show (none while the day notes feature is off); waiting: dates with a note not sent yet
const props = defineProps<{ groups: NightGroup<NightRow, DreamRow>[]; counts: Map<string, number>; selected?: string; bare?: boolean; notes?: DayNote[]; waiting?: string[] }>();
const emit = defineEmits<{ open: [id: string]; finish: [id: string]; night: [id: string]; note: [date: string] }>();
const fmt = useFmt();
const label = (d: DreamRow) => d.title?.trim() || d.text?.trim().slice(0, 90) || "Untitled dream";
const details = (n: NightRow) => nightLine(n) || "Add bedtime and techniques";
type Note = { date: string; text: string; waiting: boolean };
type Day = { key: string; date: string; group?: NightGroup<NightRow, DreamRow>; note?: Note };
// the groups in their order (newest first), each date's note on its last group (a nap of that day comes after its
// night), and the dates with only a note slotted in by date
const days = computed<Day[]>(() => {
  const notes = new Map<string, Note>();
  for (const n of props.notes ?? []) if (n.text?.trim()) notes.set(n.date, { date: n.date, text: n.text.trim(), waiting: false });
  for (const d of props.waiting ?? []) notes.set(d, { date: d, text: notes.get(d)?.text ?? "", waiting: true });
  const out: Day[] = props.groups.map((g) => ({ key: g.night.id, date: g.night.date, group: g }));
  for (let i = out.length - 1; i >= 0; i--) {
    const d = out[i]!, n = notes.get(d.date);
    if (n) { d.note = n; notes.delete(d.date); }
  }
  for (const n of notes.values()) {
    const at = out.findIndex((d) => d.date < n.date);
    out.splice(at < 0 ? out.length : at, 0, { key: "n" + n.date, date: n.date, note: n });
  }
  return out;
});
const noteLine = (n: Note) => (n.waiting ? "Kept on this device · sent when you're back online" : n.text);
const sub = (d: DreamRow, els: number) => [...dreamListMarks(d), els ? `${els} element${els === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "Dream";
</script>

<template>
  <section v-for="day in days" :key="day.key">
    <div v-if="!bare" class="sh"><h2>{{ fmt.date(day.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) }}</h2><span class="tiny">{{ !day.group ? "" : day.group.night.nap ? "Nap" : day.group.dreams.length ? (day.group.dreams.length === 1 ? "1 dream" : `${day.group.dreams.length} dreams`) : "" }}</span></div>
    <div class="card jnc" :class="{ b: bare }"><div class="list">
      <template v-if="day.group">
        <button class="li click jrow" :aria-label="`${day.group.dreams.length ? '' : 'No recall · '}Night details: ${details(day.group.night)}`" @click="emit('night', day.group.night.id)">
          <Icon name="moon" :size="18" class="jmut" />
          <div class="grow jmin"><div v-if="!day.group.dreams.length" class="t jmut">No recall</div><div class="s ellipsis" :class="{ jacc: !nightLine(day.group.night) }">{{ details(day.group.night) }}</div></div>
        </button>
        <button v-for="d in day.group.dreams" :key="d.id" class="li click jrow" :class="{ on: selected === d.id }" :aria-current="(selected === d.id) || undefined" @click="d.unfinished ? emit('finish', d.id) : emit('open', d.id)">
          <Icon :name="d.lucid ? 'sparkle' : 'book'" :size="18" :class="d.lucid ? 'jacc' : 'jmut'" />
          <div class="grow jmin"><div class="t ellipsis">{{ label(d) }}</div><div class="s ellipsis"><span v-if="d.unfinished" class="jacc">Finish writing · </span>{{ sub(d, counts.get(d.id) ?? 0) }}</div></div>
          <span class="r jmk"><Icon v-if="d.nightmare" name="flame" :size="16" class="jneg" :aria-label="'Nightmare'" /><Icon v-if="d.favourite" name="star" :size="16" class="jacc" :aria-label="'Favourite'" /></span>
        </button>
      </template>
      <button v-if="day.note" class="li click jrow" :aria-label="`Day note: ${noteLine(day.note)}`" @click="emit('note', day.date)">
        <Icon name="note" :size="18" class="jmut" />
        <div class="grow jmin"><div class="t">Day note</div><div class="s ellipsis">{{ noteLine(day.note) }}</div></div>
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
