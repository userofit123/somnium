<script setup lang="ts">
// The SSILD timer (PLAN.md §6.4, LDJ-25): Cosmic Iron's cycle [D19] - sight, sound, body - first fast cycles (4-6, a few
// seconds per step, a warm-up), then slow ones (3-4 in the tutorial, at least about 30 s per step; ILDIS asked for at
// least four [D12]). Voice-free: a soft visual pulse on every step and, if switched on, a very quiet tone on the slow
// ones. The screen dims further and stays awake while it runs; stop at any time. Timing: shared guided.ts.
import { computed, ref, watch } from "vue";
import { clockText, ssildAt, ssildSchedule, SSILD, type Sense } from "@somnium/shared";
import { readStr, writeStr } from "../../../core/prefs";
import { useClock, useTone, useWakeLock } from "./useGuided";
import NumStep from "../../NumStep.vue";
import Ev from "./Ev.vue";

const emit = defineEmits<{ cite: [ids: string[]]; running: [on: boolean]; done: [] }>();
const fast = ref<number>(SSILD.fast.default), slow = ref<number>(SSILD.slow.default);
const tone = ref(readStr("somniumGuidedTone", "0") === "1");
watch(tone, (v) => writeStr("somniumGuidedTone", v ? "1" : "0"));
const plan = computed(() => ssildSchedule(fast.value, slow.value));
const SENSE: Record<Sense, { name: string; how: string }> = {
  sight: { name: "Sight", how: "Attend to the darkness behind your eyelids. Don't strain or move your eyes to look for anything." },
  sound: { name: "Sound", how: "Relax your eyes further and listen: sounds inside, like ringing or your heartbeat, or outside if it is quiet." },
  body: { name: "Body", how: "Feel your body: tingling, heaviness, lightness, spinning. If nothing, the blanket's weight, your heartbeat, the air." },
};

const clock = useClock(), wake = useWakeLock(), beep = useTone();
const state = ref<"setup" | "run" | "end" | "stopped">("setup");
const cur = computed(() => ssildAt(plan.value, clock.sec.value));
const idx = computed(() => (cur.value ? plan.value.steps.indexOf(cur.value) : -1));
const left = computed(() => plan.value.total - clock.sec.value);

watch(idx, (i, was) => {
  if (state.value !== "run") return;
  if (i === -1 && was !== -1) { void finish("end"); return; }
  const s = plan.value.steps[i];
  if (tone.value && s && (s.phase === "slow" || s.cycle === 1 && s.sense === "sight")) beep.play();
});
function start() {
  if (tone.value) beep.prime();
  state.value = "run"; emit("running", true);
  clock.start(); void wake.on();
}
async function finish(to: "end" | "stopped") {
  clock.stop(); state.value = to; emit("running", false);
  await wake.off();
}
</script>

<template>
  <template v-if="state === 'setup' || state === 'stopped'">
    <div class="gbody">
      <h1>SSILD</h1>
      <p class="glead">Lie back in bed, eyes closed. Move your attention through sight, sound and body: first a few quick rounds, then slow ones.</p>
      <p v-if="state === 'stopped'" class="gp">Stopped. Start again when you like, or just sleep.</p>
      <div class="gbox">
        <div class="grow2"><div><div class="t">Fast cycles</div><div class="glabel">a few seconds per step</div></div>
          <NumStep :value="fast" :min="SSILD.fast.min" :max="SSILD.fast.max" label="Fast cycles" @set="(v) => (fast = v)" /></div>
        <div class="grow2"><div><div class="t">Slow cycles</div><div class="glabel">about 30 s per step</div></div>
          <NumStep :value="slow" :min="SSILD.slow.min" :max="SSILD.slow.max" label="Slow cycles" @set="(v) => (slow = v)" /></div>
        <label class="gtgl"><input v-model="tone" type="checkbox" /> A quiet tone on each slow step</label>
        <div class="glabel">About {{ Math.round(plan.total / 60) }} min in all</div>
      </div>
      <Ev text="Cosmic Iron's tutorial: 4-6 fast cycles of a few seconds per step, then 3-4 slow ones of at least about 30 seconds per step, without counting [D19]. In the one large study, SSILD after WBTB gave lucid dreams on 16.9% of nights, as MILD did [D12]." @cite="emit('cite', $event)" />
      <Ev text="Don't try to see, hear or feel anything in particular; it is better to expect nothing [D19]." @cite="emit('cite', $event)" />
    </div>
    <div class="gfoot"><button class="btn" @click="start">Start</button></div>
  </template>
  <template v-else-if="state === 'run'">
    <div class="gbody">
      <div class="gsub">{{ cur?.phase === "fast" ? "Fast" : "Slow" }} cycle {{ cur?.cycle }} of {{ cur?.phase === "fast" ? fast : slow }} · {{ clockText(left) }} left</div>
      <div :key="idx" class="gpulse" aria-hidden="true"><span>{{ cur ? SENSE[cur.sense].name : "" }}</span></div>
      <p class="glead" aria-live="polite" style="text-align:center">{{ cur ? SENSE[cur.sense].how : "" }}</p>
    </div>
    <div class="gfoot"><button class="btn o" @click="finish('stopped')">Stop</button></div>
  </template>
  <template v-else>
    <div class="gbody">
      <h1>Now sleep</h1>
      <p class="glead">Turn to your most comfortable position and fall asleep as quickly as you can. Don't overthink whether it will work.</p>
      <Ev text="Do a reality check after every awakening tonight, including ones that feel like lying awake: false awakenings are common after SSILD [D19]." big @cite="emit('cite', $event)" />
    </div>
    <div class="gfoot"><button class="btn o" @click="emit('done')">Close</button></div>
  </template>
</template>
