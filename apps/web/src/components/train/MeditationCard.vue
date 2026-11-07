<script setup lang="ts">
// Meditation timer (optional feature, LDJ-26): 5, 10, 15 or 20 minutes, a dimmed screen while it runs and a soft tone
// at the end; a finished sit is logged as the day's meditation habit. The evidence line is the honest one from
// RESEARCH.md 3.9 (Baird et al. 2019): the trial was negative, the trait correlates.
import { computed, onBeforeUnmount, ref } from "vue";
import { MEDITATION_HABIT, MEDITATION_MINUTES, habitStreak } from "@somnium/shared";
import { logMeditation } from "../../api/train";
import { toastError } from "../../core/toast";
import { useHabits } from "./useHabits";

const h = useHabits();
const picked = ref<number>(10);
const endAt = ref(0), left = ref(0), running = ref(false), finished = ref(false);
let timer = 0, ctx: AudioContext | null = null, lock: { release: () => Promise<void> } | null = null;
const row = computed(() => h.rowOf(MEDITATION_HABIT));
const mmss = computed(() => `${Math.floor(left.value / 60)}:${String(left.value % 60).padStart(2, "0")}`);

function tone() {
  // two soft sine notes with a slow fade; created on Start (a tap) so the browser allows it
  if (!ctx) return;
  for (const [f, at] of [[528, 0], [396, 0.9]] as const) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at;
    o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 3.1);
  }
}
async function start() {
  try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { ctx = null; }
  try { lock = await (navigator as any).wakeLock?.request("screen"); } catch { lock = null; }
  endAt.value = Date.now() + picked.value * 60_000; left.value = picked.value * 60; running.value = true; finished.value = false;
  timer = window.setInterval(async () => {
    left.value = Math.max(0, Math.round((endAt.value - Date.now()) / 1000));
    if (left.value > 0) return;
    stop(); finished.value = true; tone();
    await logMeditation(h.today.value, picked.value, row.value).catch(toastError);
  }, 500);
}
function stop() { clearInterval(timer); running.value = false; void lock?.release().catch(() => {}); lock = null; }
onBeforeUnmount(stop);
</script>

<template>
  <section class="tmed">
    <div class="sh"><h2>Meditation</h2><span v-if="habitStreak(h.rows.value, MEDITATION_HABIT, h.today.value)" class="tiny num">{{ habitStreak(h.rows.value, MEDITATION_HABIT, h.today.value) }} days</span></div>
    <div class="card">
      <div class="seg"><button v-for="m in MEDITATION_MINUTES" :key="m" :class="{ on: picked === m }" @click="picked = m">{{ m }} min</button></div>
      <div class="tmedrow"><button class="btn s" @click="start()">Start</button><span v-if="finished" class="tiny">Done. Logged for today.</span><span v-else-if="row" class="tiny">Today: {{ row.minutes ?? 0 }} min</span></div>
      <p class="tiny">Long-term meditators report more lucid dreams, but an 8-week mindfulness course did not raise lucid dreaming in a randomised trial: the trait correlates, the course did not cause it (Baird et al. 2019).</p>
    </div>
    <div v-if="running" class="tdim" role="dialog" aria-label="Meditation timer">
      <div class="tdimt num">{{ mmss }}</div>
      <button class="btn o s" @click="stop()">End early</button>
    </div>
  </section>
</template>
