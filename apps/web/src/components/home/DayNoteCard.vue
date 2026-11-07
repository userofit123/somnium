<script setup lang="ts">
// Day note (optional, LDJ-41): a short sealed line about a day, for the dream-lag view in Insights. Written for today
// or any earlier date; saved on leaving the field. Only shown while Settings → Features → Day notes is on.
import { computed, ref, watch } from "vue";
import { useDayNotes, saveDayNote } from "../../api/extras";
import { toast, toastError } from "../../core/toast";

const props = defineProps<{ today: string }>();
const notes = useDayNotes();
const date = ref(props.today);
const existing = computed(() => (notes.data.value ?? []).find((n) => n.date === date.value));
const text = ref("");
const saved = ref("");
watch([existing, date], () => { text.value = existing.value?.text ?? ""; saved.value = text.value; }, { immediate: true });
async function save() {
  if (text.value.trim() === saved.value.trim()) return;
  try { await saveDayNote(existing.value, date.value, text.value); saved.value = text.value; toast("Saved"); } catch (e) { toastError(e); }
}
</script>

<template>
  <section class="hextra" data-testid="daynote">
    <div class="sh"><h2>Day note</h2><input v-model="date" type="date" :max="today" class="tiny" aria-label="Date of the note" /></div>
    <div class="card">
      <div class="fld"><label for="h-daynote">What happened {{ date === today ? "today" : "that day" }}</label>
        <textarea id="h-daynote" v-model="text" rows="2" maxlength="1000" placeholder="A line is enough: people, places, things you did" @blur="save" /></div>
      <div class="tiny">Kept sealed like your dreams. Insights uses it to see what comes back in dreams days later.</div>
    </div>
  </section>
</template>
