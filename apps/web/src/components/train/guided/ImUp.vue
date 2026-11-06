<script setup lang="ts">
// "I'm up" (PLAN.md §9, LDJ-25), opened from the WBTB alarm or Train: a soft count-up of the minutes awake, what to do
// while up (dream work, which is what made the waking period count [D13]), and "Back to bed", which stores wbtb_used
// and wbtb_minutes_awake on the night and then offers MILD or SSILD. The start time is kept on this device, so
// writing the dream down in the Journal and coming back keeps counting.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { uuidv7 } from "@somnium/engine/sealed-api";
import { backToBed, nightNowDate } from "../../../api/train";
import { setWbtbAlarm, wbtbAlarm } from "../../../native/reminders";
import { readStr, writeStr } from "../../../core/prefs";
import { toastError } from "../../../core/toast";
import { useClock, useWakeLock } from "./useGuided";
import Ev from "./Ev.vue";
import type { GuidedMode } from "./GuidedView.vue";

const emit = defineEmits<{ cite: [ids: string[]]; go: [m: GuidedMode] }>();
const router = useRouter();
const UP = "somniumWbtbUp";
let t0 = Number(readStr(UP, "0"));
if (!t0 || Date.now() - t0 > 4 * 3_600_000) { t0 = Date.now(); writeStr(UP, String(t0)); }
const clock = useClock();
clock.start(t0);
const wake = useWakeLock();
void wake.on();
const minutes = computed(() => Math.floor(clock.sec.value / 60));
const target = Number(readStr("somniumWbtbAwake", "30")) || 30;
const date = nightNowDate();

const done = ref(false), busy = ref(false), saved = ref(0);
async function back() {
  busy.value = true;
  try {
    saved.value = minutes.value;
    await backToBed(saved.value, date);
    writeStr(UP, "0");
    clock.stop(); await wake.off();
    if (wbtbAlarm()) await setWbtbAlarm(null);
    done.value = true;
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
const writeDream = () => router.push({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1", date } });
</script>

<template>
  <template v-if="!done">
    <div class="gbody">
      <h1>You're up</h1>
      <div class="gbig" aria-live="off">{{ minutes }} min</div>
      <div class="gsub">awake · your plan was about {{ target }} min</div>
      <p class="glead">Keep the lights low. Use the time for dream work:</p>
      <ul class="glist gp">
        <li><button type="button" class="ginl" @click="writeDream">Write down the last dream</button>, while it is fresh.</li>
        <li><router-link to="/learn/techniques/mild">Read about MILD</router-link> and rehearse it.</li>
      </ul>
      <Ev text="What you do while up matters: dream work and MILD gave lucid dreams in the laboratory, reading fiction 9% and games none [D13]." @cite="emit('cite', $event)" />
    </div>
    <div class="gfoot"><button class="btn" :disabled="busy" @click="back">Back to bed</button></div>
  </template>
  <template v-else>
    <div class="gbody">
      <h1>Back to bed</h1>
      <p class="glead">Saved: {{ saved }} min awake. Now a technique while you fall asleep.</p>
      <Ev text="MILD is the best supported; SSILD matched it in the one large study that tested it [D12]." @cite="emit('cite', $event)" />
    </div>
    <div class="gfoot">
      <button class="btn" @click="emit('go', 'mild')">MILD</button>
      <button class="btn o" @click="emit('go', 'ssild')">SSILD</button>
    </div>
  </template>
</template>
