<script setup lang="ts">
// Day note (optional, LDJ-41): a short sealed line about a day, for the dream-lag view in Insights. Written for today
// or any earlier date; saved on leaving the field, on changing the date and on leaving the page. Offline it is kept
// sealed on this device and sent later (api/extras.ts), and the card says so. Only shown while Settings → Features →
// Day notes is on.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useDayNotes, saveDayNote, waitingDayNote, waitingDayNotes, flushDayNotes } from "../../api/extras";
import { toast, toastError } from "../../core/toast";

const props = defineProps<{ today: string }>();
const notes = useDayNotes();
const date = ref(props.today);
const existing = computed(() => (notes.data.value ?? []).find((n) => n.date === date.value));
const waiting = computed(() => waitingDayNotes.value.includes(date.value));
const text = ref("");
// what the field held when it was last loaded or saved: text that differs from it is unsaved
const saved = ref("");
const dirty = () => text.value.trim() !== saved.value.trim();
let loading = 0;
async function load() {
  const n = ++loading;
  const kept = waiting.value ? await waitingDayNote(date.value) : null;
  if (n !== loading) return;
  text.value = kept ?? existing.value?.text ?? ""; saved.value = text.value;
}
// a change from elsewhere (another device, the offline note sent) shows, but never over text typed and not saved yet
watch(existing, () => { if (!dirty()) void load(); });
void load();
void flushDayNotes();

let saving: Promise<boolean> | null = null;
async function save(forDate = date.value): Promise<boolean> {
  if (!dirty()) return true;
  const t = text.value;
  try {
    saving = saveDayNote(forDate, t);
    const later = await saving;
    saved.value = t;
    toast(later ? "Kept on this device · sent when you're back online" : "Saved");
    return true;
  } catch (e) { toastError(e); return false; } finally { saving = null; }
}
// another date with unsaved text: the text is saved to its own date first; if that fails, the date stays put
let reverting = false;
watch(date, async (_now, before) => {
  if (reverting) { reverting = false; return; }
  if (dirty()) {
    if (saving) await saving;
    if (dirty() && !(await save(before))) { reverting = true; date.value = before; return; }
  }
  void load();
});
onBeforeUnmount(() => { if (dirty()) void save(); });
</script>

<template>
  <section class="hextra" data-testid="daynote">
    <div class="sh"><h2>Day note</h2><input v-model="date" type="date" :max="today" class="tiny" aria-label="Date of the note" /></div>
    <div class="card">
      <div class="fld"><label for="h-daynote">What happened {{ date === today ? "today" : "that day" }}</label>
        <textarea id="h-daynote" v-model="text" rows="2" maxlength="1000" placeholder="A line is enough: people, places, things you did" @blur="save()" /></div>
      <div class="tiny">{{ waiting ? "Kept sealed on this device. Sent when you're back online." : "Kept sealed like your dreams. Insights uses it to see what comes back in dreams days later." }}</div>
    </div>
  </section>
</template>
