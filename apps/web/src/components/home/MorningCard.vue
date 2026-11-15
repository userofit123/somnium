<script setup lang="ts">
// "This morning" (PLAN.md §6.1): a hero card (as Motus's TodayHero) with a button to write last night's dream (tonal on the hero: Today's step above
// holds Home's one filled button, LDJ-107) and a quiet "No recall", until the night has a dream or the mark; then it shrinks to a one-line summary (LDJ-230).
// Titles only: Home never shows dream text. Under the summary, once, the night's question: did you do last night's
// techniques (NightCheckIn, LDJ-79). Dreams the capture saved as key words show as a quiet "Finish writing: 2 dreams"
// until written out or until evening, when little of the dream is left to add (LDJ-162, RESEARCH.md C1, C2).
import { computed } from "vue";
import { useRouter } from "vue-router";
import { morningLine, unfinishedOf, type MorningState } from "@somnium/shared";
import { markNoRecall, useJournal, uuidv7 } from "../../api/journal";
import { useChange } from "../../api/queries";
import Icon from "../Icon.vue";
import NightCheckIn from "../journal/NightCheckIn.vue";

const props = defineProps<{ state: MorningState; date: string }>();
const router = useRouter();
const line = computed(() => morningLine(props.state));
const j = useJournal();
const night = computed(() => j.nights.data.value?.find((n) => n.date === props.date && !n.nap));
const unfinished = computed(() => (night.value && new Date().getHours() < 18 ? unfinishedOf((j.dreams.data.value ?? []).filter((d) => d.nightId === night.value!.id)) : []));
// one tap: the first of them opens to write; the editor says what is left
const finish = () => { const d = unfinished.value[0]; if (d) router.push({ name: "journal-write", params: { id: d.id } }); };
const write = () => router.push({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1", date: props.date } });
const noRecall = useChange(() => markNoRecall(props.date), ["journal", "home"]);
</script>

<template>
  <section class="hmorning">
    <div v-if="state.kind === 'open'" class="card hero hwrite">
      <div class="lbl"><span class="bi"><Icon name="moon" :size="16" /></span>This morning</div>
      <div class="hw-t">Write last night's dream</div>
      <div class="hw-s">Write it down before it fades - even a fragment counts.</div>
      <div class="hw-acts">
        <button class="btn hw-btn" @click="write"><Icon name="plus" :size="18" />Write it down</button>
        <button type="button" class="lnk inl" :disabled="noRecall.busy.value" @click="noRecall.run()">No recall</button>
      </div>
    </div>
    <div v-else class="card">
      <div class="hsum">
        <span class="bi"><Icon name="moon" :size="16" /></span>
        <div class="grow"><div class="t">This morning · last night</div><div class="tiny">{{ line }}</div></div>
        <span v-if="state.kind === 'logged' && state.nightmare" class="mchip nightmare">Nightmare</span>
        <span v-else-if="state.kind === 'logged' && state.lucid" class="mchip lucid">Lucid</span>
      </div>
      <div v-if="state.kind === 'logged' && state.titled.length" class="htitles">
        <router-link v-for="d in state.titled" :key="d.id" :to="{ name: 'journal-dream', params: { id: d.id } }" class="tiny">{{ d.title }}</router-link>
      </div>
      <button v-if="unfinished.length" type="button" class="lnk inl hfin" @click="finish">Finish writing: {{ unfinished.length === 1 ? "1 dream" : `${unfinished.length} dreams` }}</button>
      <NightCheckIn v-if="night" :key="night.id" :night="night" :nights="j.nights.data.value ?? []" class="hnci" />
      <div class="hfoot"><router-link to="/journal" class="lnk inl">Open the Journal</router-link><button type="button" class="lnk inl" @click="write">Add another dream</button></div>
    </div>
  </section>
</template>

<style scoped>
.lnk.hfin { display: block; margin-top: var(--lpy); }
.hnci { margin-top: var(--lpy); padding-top: var(--lpy); border-top: 1px solid var(--ol); }
</style>
