<script setup lang="ts">
// The morning's night question (LDJ-79): "Last night you planned: MILD · WBTB. Did you do them?", a Yes or No each,
// and after MILD or SSILD how long it took to fall asleep. It is what fills "What works for you" (Insights compares
// nights with and without each technique) for someone who practised in bed without opening the app, and the minutes
// are the strongest predictor Aspy found (RESEARCH.md [37][38]). Asked once per night, never in the way of writing:
// Home's This morning card and the Journal's last-night strip show it under what was logged. Each tap is saved at once
// (api/nightCheckIn.ts); a "No" or "Skip" is remembered on this device so it isn't asked again.
import { computed, reactive, ref } from "vue";
import { ASKS_ASLEEP, ASLEEP_CHIPS, asleepChip, checkInAnswered, checkInTechniques, isPlanOnly, minutesToSleep, techniquesDoneOf, TECHNIQUES } from "@somnium/shared";
import type { NightRow } from "../../api/journal";
import { answerAsleep, answerTechnique, askedNights, markAsked } from "../../api/nightCheckIn";
import { toastError } from "../../core/toast";
import NightSheet from "./NightSheet.vue";

// card: on a card of its own (the Journal's last-night strip), which goes with it once answered
const props = defineProps<{ night: NightRow; nights: NightRow[]; card?: boolean }>();
const label = (id: string) => TECHNIQUES.find((t) => t.id === id)?.label ?? id;

// what to ask is settled when it first shows: a tap that changes the night must not reshuffle the rows under the finger
const ask = checkInTechniques(props.night, props.nights);
// a night that already holds the answer (a guided screen logged it all) isn't asked about
const already = checkInAnswered(props.night);
const show = computed(() => !already && !props.night.nap && !isPlanOnly(props.night) && !askedNights.value.includes(props.night.id));

// the answers given here: Yes is pre-set where the night already has the technique (a guided screen or "I'm up" logged it)
const logged = techniquesDoneOf(props.night);
const ans = reactive<Record<string, boolean | undefined>>(Object.fromEntries(ask.ids.map((id) => [id, logged.includes(id) || undefined])));
const chip = ref(asleepChip(minutesToSleep(props.night)));
const asksAsleep = computed(() => ask.ids.some((id) => ans[id] && ASKS_ASLEEP.includes(id)));
const ticked = computed(() => ask.ids.some((id) => ans[id]));
const summary = computed(() => ask.ids.map(label).join(" · "));

// the night as the saved answers left it: each answer builds on the one before it (they are saved in turn,
// api/nightCheckIn.ts), not on a list not refetched yet
let done = [...logged];
// A failed save puts the answer back and leaves the question open: the night is only marked answered once what was
// tapped is on it (minutes to sleep are sealed, so on the direct path with no connection they can't be saved yet).
async function answer(id: string, did: boolean) {
  const was = ans[id];
  ans[id] = did;
  try { done = await answerTechnique(props.night.id, () => done, id, did); }
  catch (e) { if (ans[id] === did) ans[id] = was; toastError(e); return; }
  if (ask.planned) finishWhenComplete();
}
async function pickAsleep(i: number) {
  const was = chip.value;
  const now = was === i ? -1 : i;
  chip.value = now;
  try { await answerAsleep(props.night.id, now < 0 ? null : ASLEEP_CHIPS[i]!.minutes); }
  catch (e) { if (chip.value === now) chip.value = was; toastError(e); return; }
  if (ask.planned) finishWhenComplete();
}
// the plan's question ends by itself once each technique has its answer, and the minutes when they are asked
function finishWhenComplete() {
  if (ask.ids.every((id) => ans[id] !== undefined) && (!asksAsleep.value || chip.value >= 0)) markAsked(props.night.id);
}
const finish = () => markAsked(props.night.id);
const detailsOpen = ref(false);
</script>

<template>
  <div v-if="show" class="nci" :class="{ card }">
    <div class="t">{{ ask.planned ? `Last night you planned: ${summary}. Did you do ${ask.ids.length === 1 ? "it" : "them"}?` : "Did you try anything last night?" }}</div>
    <div v-if="ask.planned" class="nci-rows">
      <div v-for="id in ask.ids" :key="id" class="nci-r">
        <span class="grow">{{ label(id) }}</span>
        <div class="seg" role="group" :aria-label="label(id)">
          <button type="button" :class="{ on: ans[id] === true }" :aria-pressed="ans[id] === true" @click="answer(id, true)">Yes</button>
          <button type="button" :class="{ on: ans[id] === false }" :aria-pressed="ans[id] === false" @click="answer(id, false)">No</button>
        </div>
      </div>
    </div>
    <div v-else class="chips" role="group" aria-label="Techniques tried last night">
      <button v-for="id in ask.ids" :key="id" type="button" class="fchip" :class="{ on: ans[id] }" :aria-pressed="!!ans[id]" @click="answer(id, !ans[id])">{{ label(id) }}</button>
    </div>
    <template v-if="asksAsleep">
      <div class="tiny nci-q">How long to fall asleep after it?</div>
      <div class="chips" role="group" aria-label="How long to fall asleep">
        <button v-for="(c, i) in ASLEEP_CHIPS" :key="c.label" type="button" class="fchip" :class="{ on: chip === i }" :aria-pressed="chip === i" @click="pickAsleep(i)">{{ c.label }}</button>
      </div>
    </template>
    <div class="nci-foot">
      <button v-if="!ask.planned" type="button" class="lnk inl" @click="finish">{{ ticked ? "Done" : "Nothing" }}</button>
      <button v-else type="button" class="lnk inl" @click="finish">Skip</button>
      <button type="button" class="lnk inl" @click="detailsOpen = true">Night details</button>
    </div>
    <NightSheet v-if="detailsOpen" :date="night.date" :nap="night.nap" :night-id="night.id" @close="detailsOpen = false" />
  </div>
</template>

<style scoped>
.nci { display: flex; flex-direction: column; gap: var(--lpy); }
.nci .t { color: var(--tx); }
.nci-rows { display: flex; flex-direction: column; gap: var(--lpy); }
.nci-r { display: flex; align-items: center; gap: var(--lpy); }
.nci-q { color: var(--tx2); }
.nci-foot { display: flex; gap: var(--cpx); flex-wrap: wrap; }
</style>
