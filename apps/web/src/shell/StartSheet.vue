<script setup lang="ts">
// The + sheet (PLAN.md §6.0, LDJ-92; Motus's StartSheet): the day's actions from any screen, one tap plus the action.
// Each row hands over to the flow that already does it: the morning capture or the editor, the journal's No recall,
// the reality check screen, Train > Tonight, and the day note (only while that feature is on).
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { isPlanOnly, nightOfDate } from "@somnium/shared";
import { api } from "../api/client";
import { useSettings } from "../api/queries";
import { markNoRecall, uuidv7, type NightRow } from "../api/journal";
import { useToday } from "../core/today";
import { toast, toastError } from "../core/toast";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";
import DayNoteCard from "../components/home/DayNoteCard.vue";

const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const s = useSettings();
const today = useToday();
// the journal's own list of nights (same query as the Journal), so No recall goes once last night is logged; if the
// list can't be had it still shows (markNoRecall itself refuses a night with dreams)
const nights = useQuery({ queryKey: ["journal", "nights"], queryFn: () => api.get<NightRow[]>("/nights", { all: 1 }) });
// a night that is only tonight's plan is not a logged morning (as on the Journal)
const lastLogged = computed(() => { const n = nightOfDate(nights.data.value ?? [], today.value); return !!n && !isPlanOnly(n); });
const dayNote = ref(false);

const go = (to: Parameters<typeof router.push>[0]) => { emit("close"); router.push(to); };
// last night's date, so the router's captureFirst opens the still, dim morning capture (LDJ-80). Later in the day
// (from noon, as Train's night-of-now) it is the plain editor, which starts on today's date by itself
const morning = new Date().getHours() < 12;
function write() {
  go({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1", ...(morning ? { date: today.value } : {}) } });
}
async function noRecall() {
  emit("close");
  try { await markNoRecall(today.value); toast("No recall logged"); } catch (e) { toastError(e); }
}
</script>

<template>
  <Sheet v-if="dayNote" title="Day note" @close="emit('close')">
    <template #head><button class="ib sm plain" aria-label="Back" @click="dayNote = false"><Icon name="left" /></button><b>Day note</b></template>
    <DayNoteCard :today="today" bare />
  </Sheet>
  <Sheet v-else title="Add" @close="emit('close')">
    <div class="opt-list">
      <button class="optb" @click="write"><span class="oi"><Icon name="book" /></span><div class="grow"><div class="t">Write a dream</div><div class="s">{{ morning ? "Last night's, while it is still there. A fragment counts." : "Any night's dream, or a nap" }}</div></div></button>
      <button v-if="!lastLogged && !nights.isPending.value" class="optb" @click="noRecall"><span class="oi"><Icon name="moon" /></span><div class="grow"><div class="t">No recall last night</div><div class="s">Logs the night with no dreams remembered</div></div></button>
      <button class="optb" @click="go('/check')"><span class="oi"><Icon name="eye" /></span><div class="grow"><div class="t">Log a reality check</div><div class="s">Whether it said you were awake or dreaming</div></div></button>
      <button class="optb" @click="go('/train/tonight')"><span class="oi"><Icon name="target" /></span><div class="grow"><div class="t">Plan tonight</div><div class="s">Your intention and the technique for tonight</div></div><Icon name="right" /></button>
      <button v-if="s.features.dayNotes" class="optb" @click="dayNote = true"><span class="oi"><Icon name="note" /></span><div class="grow"><div class="t">Day note</div><div class="s">A line about your day</div></div><Icon name="right" /></button>
    </div>
  </Sheet>
</template>
