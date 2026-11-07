<script setup lang="ts">
// Prospective-memory training (LDJ-50, LaBerge; RESEARCH.md 1.6): set the day's four targets from a fixed list, then log
// each as a hit or a miss with a big button. The list is fixed on purpose: a typed target would be personal text that
// needs sealing, an id from the list is plain (the same choice reminders make for their labels).
import { computed, ref } from "vue";
import { PM_TARGETS, PM_LABERGE_DAY, PM_PER_DAY, PM_STEPS, pmDay, pmTargetText, pmWeek } from "@somnium/shared";
import { setPmTarget, logPm } from "../../api/train";
import { useChange } from "../../api/queries";
import { useHabits } from "./useHabits";
import Icon from "../Icon.vue";

const h = useHabits();
const day = computed(() => pmDay(h.rows.value, h.today.value));
const week = computed(() => pmWeek(h.rows.value, h.today.value));
const choosing = ref(false), how = ref(false);
const free = computed(() => PM_TARGETS.filter((t) => !day.value.targets.some((x) => x.id === t.id)));
const toggle = useChange((id: string, on: boolean) => setPmTarget(h.today.value, id, on, h.rows.value), ["practice"]);
const laberge = useChange(async () => { for (const id of PM_LABERGE_DAY) if (!day.value.targets.some((x) => x.id === id) && day.value.targets.length < PM_PER_DAY) await setPmTarget(h.today.value, id, true, h.rows.value); }, ["practice"]);
const log = useChange((id: string, s: "hit" | "miss") => logPm(h.today.value, id, s, h.rows.value), ["practice"]);
const full = computed(() => day.value.targets.length >= PM_PER_DAY);
</script>

<template>
  <section class="tpm">
    <div class="sh"><h2>Memory targets</h2><button class="lnk tiny" @click="how = !how">{{ how ? "Hide" : "How it works" }}</button></div>
    <div class="card">
      <ol v-if="how" class="tiny pmsteps"><li v-for="s in PM_STEPS" :key="s">{{ s }}</li><li class="tiny">Source: LaBerge, Exercise in prospective memory (RESEARCH.md 1.6). No isolated test of it exists.</li></ol>
      <div v-if="!day.targets.length" class="tiny">Choose four events for today. Each time one of them next happens, do a reality check.</div>
      <div v-for="t in day.targets" :key="t.id" class="pmrow">
        <div class="grow"><div class="t">{{ pmTargetText(t.id) ?? t.id }}</div></div>
        <div v-if="t.state === 'open'" class="pmbtns">
          <button class="btn pmbig" :disabled="log.busy.value" @click="log.run(t.id, 'hit')">Hit</button>
          <button class="btn o pmbig" :disabled="log.busy.value" @click="log.run(t.id, 'miss')">Miss</button>
        </div>
        <button v-else class="lnk tiny" :aria-label="'Undo ' + t.state" @click="log.run(t.id, t.state)"><Icon :name="t.state === 'hit' ? 'check' : 'close'" :size="14" /> {{ t.state === "hit" ? "Hit" : "Miss" }}</button>
        <button v-if="t.state === 'open'" class="cx" :aria-label="'Remove target'" @click="toggle.run(t.id, false)"><Icon name="close" :size="16" /></button>
      </div>
      <div v-if="!full" class="pmpick">
        <button class="lnk tiny" @click="choosing = !choosing">{{ choosing ? "Close list" : `Choose targets (${day.targets.length} of ${PM_PER_DAY})` }}</button>
        <button v-if="!day.targets.length" class="lnk tiny" @click="laberge.run()">Use LaBerge's example day</button>
        <div v-if="choosing" class="pmlist"><button v-for="t in free" :key="t.id" class="chip" :disabled="toggle.busy.value" @click="toggle.run(t.id, true)">{{ t.text }}</button></div>
      </div>
      <p v-if="week.set" class="tiny pmweek">This week: {{ week.hit }} of {{ week.hit + week.miss }} hit<template v-if="week.rate != null"> · {{ Math.round(week.rate * 100) }}%</template></p>
    </div>
  </section>
</template>
