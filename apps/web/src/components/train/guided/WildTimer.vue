<script setup lang="ts">
// The WILD relaxation timer (PLAN.md §6.4, LDJ-25): a slow, minimal guide after LaBerge's preliminaries and hypnagogic
// imagery technique [D1] - relax the body, watch the images without holding on, keep a light focus and let yourself be
// drawn in - for a set time, with the sleep paralysis note RESEARCH.md gives (Part B §6.3, Part D §2.1). WILD has no
// controlled trial [B15]. The phase split is the app's own pacing (shared guided.ts wildPhase). With the tone switched
// on (SSILD's switch), a quiet tone marks each new phase; on Android it plays with the screen off (LDJ-115).
import { computed, ref, watch } from "vue";
import { clockText, wildCues, wildPhase, WILD_MINUTES } from "@somnium/shared";
import { useClock, useNightTones, useWakeLock } from "./useGuided";
import { readStr } from "../../../core/prefs";
import Ev from "./Ev.vue";

const emit = defineEmits<{ cite: [ids: string[]]; running: [on: boolean]; done: [] }>();
const mins = ref<number>(15);
const total = computed(() => mins.value * 60);
const clock = useClock(), wake = useWakeLock(), tones = useNightTones();
const tone = readStr("somniumGuidedTone", "0") === "1";
const state = ref<"setup" | "run" | "end">("setup");
const phase = computed(() => wildPhase(clock.sec.value, total.value));
const TEXT = {
  relax: { name: "Relax", how: "Let your head, neck, back, arms and legs go heavy. Breathe slowly." },
  images: { name: "Watch", how: "Notice the images behind your eyes. Watch them begin and end, gently, without holding on." },
  focus: { name: "Stay lightly aware", how: "Keep a light focus. If a scene forms, let yourself be drawn in; don't push into it." },
  done: { name: "", how: "" },
} as const;
watch(phase, (p) => {
  if (state.value !== "run") return;
  if (p === "done") void finish(false);
});
function start() {
  const t0 = Date.now();
  state.value = "run"; emit("running", true); clock.start(t0);
  // scheduled once, inside this tap (the audio needs it); playing off-screen, the phone may go dark
  const playing = tone ? tones.play(wildCues(total.value, t0), t0 + total.value * 1000) : Promise.resolve(false);
  // finish() may have run while the tones were being handed over: then the screen lock must stay released
  void playing.then((ok) => { if (state.value === "run" && !(ok && tones.offScreen)) void wake.on(); });
}
async function finish(stopped = true) { clock.stop(); state.value = "end"; emit("running", false); if (stopped) await tones.stop(); await wake.off(); }
</script>

<template>
  <template v-if="state === 'setup'">
    <div class="gbody">
      <h1>Fall asleep aware (WILD)</h1>
      <p class="glead">Fall asleep while staying a little aware. Best after WBTB or in a morning nap, lying still with your eyes closed.</p>
      <div class="glabel">Length</div>
      <div class="gchips" role="radiogroup" aria-label="Length">
        <button v-for="m in WILD_MINUTES" :key="m" type="button" class="gchip" :class="{ on: m === mins }" role="radio" :aria-checked="m === mins" @click="mins = m"><b>{{ m }} min</b></button>
      </div>
      <div class="gbox gwarn">
        <div class="t">Sleep paralysis</div>
        <Ev text="This is the route most likely to pass through sleep paralysis: unable to move, pressure, buzzing or vibrations. &quot;Sleep paralysis can be quite terrifying, but it is harmless&quot; [D1]. It ends on its own: relax, breathe, wiggle a toe or a finger [B6][B7]." @cite="emit('cite', $event)" />
      </div>
      <div v-if="tone" class="glabel">A quiet tone marks each new phase. {{ tones.offScreen ? "It plays with the screen off: you can let the phone go dark." : "It needs this page open and the screen on." }}</div>
      <Ev text="Relaxation and watching the images follow LaBerge [D1]. WILD is seen in the laboratory, but no controlled trial has tested it as a technique [B15]." @cite="emit('cite', $event)" />
    </div>
    <div class="gfoot"><button class="btn" @click="start">Start</button></div>
  </template>
  <template v-else-if="state === 'run'">
    <div class="gbody">
      <div class="gsub">{{ clockText(total - clock.sec.value) }} left</div>
      <div :key="phase" class="gpulse" aria-hidden="true"><span>{{ TEXT[phase].name }}</span></div>
      <p class="glead center" aria-live="polite">{{ TEXT[phase].how }}</p>
    </div>
    <div class="gfoot"><button class="btn o" @click="finish()">Stop</button></div>
  </template>
  <template v-else>
    <div class="gbody">
      <h1>Let go</h1>
      <p class="glead">Time is up. Stop trying and simply rest; sleep will come.</p>
      <Ev text="If an attempt doesn't work, let it go: most bad experiences come from forcing it [B76]." big @cite="emit('cite', $event)" />
    </div>
    <div class="gfoot"><button class="btn o" @click="emit('done')">Close</button></div>
  </template>
</template>
