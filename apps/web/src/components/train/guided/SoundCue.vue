<script setup lang="ts">
// Sound cue training (LDJ-48), targeted lucidity reactivation: an optional feature (Settings → Features), absent
// while off. Two parts, as in the studies (RESEARCH.md Part B §3.6):
// - Training, awake: a soft tone, then a reality check and the intention, for 20 minutes (Carr et al. 2023 trained
//   the cue with a lucid mindset for 20 minutes before a morning nap [B42]).
// - Sleep: the cue repeats quietly in a chosen window: at night from 6 hours after the training (Konkoly et al. 2024's
//   app [B43]), or in a 90-minute nap or after WBTB once the settle time has passed [D4]. It starts at a whisper,
//   stops on any touch or key and when the window ends, and logs "sound-cue" in the night's techniques_done.
// The cue spacing, loudness and settle time are the app's own (our notes don't record the studies'), said so on screen.
// Limits said plainly: a web tab must stay open with the screen on (wake lock) and the volume up; the desktop app
// must stay open; the Android app has no foreground service to play sound with the screen off, so there too the
// screen stays on.
import { computed, onBeforeUnmount, ref } from "vue";
import { cueWindow, clockText, minToHm, hmToMin, trainingPairings, isCueTone, CUE_TONES, CUE_VOLUMES, CUE_EVERY_SEC, CUE_EVERY_DEFAULT, CUE_SETTLE_MIN, CUE_SETTLE_DEFAULT, CUE_TRAIN_MIN, CUE_TRAIN_EVERY_SEC, CUE_NAP_MIN, type CueTone, type CueVolume, type CueWindowKind } from "@somnium/shared";
import { safetyLines } from "@somnium/knowledge/techniques";
import { useSettings } from "../../../api/queries";
import { cueSession, flushCueLog, startCueSession, stopCueSession } from "./cueSession";
import { androidReminders } from "../../../native/reminders";
import { readStr, writeStr } from "../../../core/prefs";
import { toast, toastError } from "../../../core/toast";
import { useClock, useCuePlayer, useWakeLock } from "./useGuided";
import Ev from "./Ev.vue";

const emit = defineEmits<{ cite: [ids: string[]]; running: [on: boolean]; done: [] }>();
const settings = useSettings();
const player = useCuePlayer();
const wake = useWakeLock();
const clock = useClock();

const keptTone = readStr("somniumCueTone", "bell");
const tone = ref<CueTone>(isCueTone(keptTone) ? keptTone : "bell");
const keptVol = readStr("somniumCueVolume", "softer");
const volume = ref<CueVolume>(keptVol in CUE_VOLUMES ? (keptVol as CueVolume) : "softer");
const every = ref<number>((CUE_EVERY_SEC as readonly number[]).includes(Number(readStr("somniumCueEvery", ""))) ? Number(readStr("somniumCueEvery", "")) : CUE_EVERY_DEFAULT);
const settle = ref<number>(CUE_SETTLE_DEFAULT);
const kind = ref<CueWindowKind>("nap");
const trainedAt = ref(Number(readStr("somniumCueTrainedAt", "0")) || 0);
const trainedToday = computed(() => trainedAt.value > Date.now() - 18 * 3_600_000);
const tab = ref<"train" | "sleep">(trainedToday.value ? "sleep" : "train");
const keep = () => { writeStr("somniumCueTone", tone.value); writeStr("somniumCueVolume", volume.value); writeStr("somniumCueEvery", String(every.value)); };
const where = (globalThis as any).somniumNative ? "desktop" : androidReminders() ? "android" : "web";
const hmOf = (ms: number) => { const d = new Date(ms); return minToHm(d.getHours() * 60 + d.getMinutes()); };
const tryTone = () => { if (player.prime()) player.cue(CUE_TONES[tone.value], CUE_VOLUMES[volume.value]); };

// ----- training -----
const pairings = trainingPairings();
const training = ref(false);
const pairing = computed(() => Math.min(pairings, Math.floor(clock.sec.value / CUE_TRAIN_EVERY_SEC) + 1));
let lastPair = 0, iv: ReturnType<typeof setInterval> | null = null;
async function startTraining() {
  keep();
  if (!player.prime()) { toast("This browser can't play sound"); return; }
  training.value = true; emit("running", true); lastPair = 0;
  clock.start(); await wake.on();
  iv = setInterval(trainTick, 500); trainTick();
}
function trainTick() {
  if (clock.sec.value >= CUE_TRAIN_MIN * 60) { void endTraining(true); return; }
  const p = Math.floor(clock.sec.value / CUE_TRAIN_EVERY_SEC) + 1;
  if (p > lastPair) { lastPair = p; player.cue(CUE_TONES[tone.value], CUE_VOLUMES.soft); }
}
async function endTraining(full: boolean) {
  if (iv) clearInterval(iv); iv = null;
  clock.stop(); await wake.off(); training.value = false; emit("running", false);
  if (full || clock.sec.value >= 60) { trainedAt.value = Date.now(); writeStr("somniumCueTrainedAt", String(trainedAt.value)); tab.value = "sleep"; }
}

// ----- sleep: the session lives in cueSession.ts so the app lock can't cut it short -----
const sleeping = cueSession.on, played = cueSession.played, win = cueSession.win;
const now = ref(Date.now());
const nowIv = setInterval(() => { now.value = Date.now(); }, 5000);
const wakeAt = () => { const w = hmToMin(settings.value.sleep.wake); if (w == null) return null; const d = new Date(); const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(w / 60), w % 60).getTime(); return t > Date.now() ? t : t + 86_400_000; };
const preview = computed(() => cueWindow(kind.value, { now: now.value, trainedAt: trainedAt.value || now.value, wakeAt: wakeAt(), settleMin: settle.value }));
function startSleep() {
  keep();
  const w = cueWindow(kind.value, { now: Date.now(), trainedAt: trainedAt.value || Date.now(), wakeAt: wakeAt(), settleMin: settle.value });
  const ok = startCueSession({ win: w, everySec: every.value, gain: CUE_VOLUMES[volume.value], tone: tone.value,
    ended: (n) => { emit("running", false); toast(n > 0 ? `Sound cue stopped · ${n} cues · logged on the night` : "Sound cue stopped before the first cue"); } });
  if (!ok) { toast("This browser can't play sound"); return; }
  emit("running", true);
}
const stopSleep = () => { void stopCueSession().catch(toastError); };
void flushCueLog();
onBeforeUnmount(() => { clearInterval(nowIv); if (iv) clearInterval(iv); });

const KINDS: { id: CueWindowKind; t: string; s: string }[] = [
  { id: "nap", t: "Nap", s: `${CUE_NAP_MIN} min` },
  { id: "wbtb", t: "After WBTB", s: `${CUE_NAP_MIN} min` },
  { id: "night", t: "Tonight", s: "from 6 h after training" },
];
const limit = computed(() => where === "desktop" ? "Keep Somnium open (the window can be in the background) and the volume up. It can't play while the computer sleeps."
  : where === "android" ? "Keep the screen on and the app in front, with the volume up: the Android app can't play sound with the screen off yet (that needs a foreground service it doesn't have)."
  : "Keep this tab open with the screen on and the volume up. A closed or hidden tab may stop the sound.");
</script>

<template>
  <div class="gbody" :data-cues="player.scheduled.value + cueSession.scheduled.value" :data-played="played">
    <h1>Sound cue</h1>
    <p class="glead">Train a soft tone with reality checks while awake; then it plays quietly while you sleep, as a reminder that you are dreaming.</p>
    <Ev text="In a laboratory nap, half the people had a signal-verified lucid dream after 20 minutes of cue training [B42]. With a phone app at home, lucid dreams rose from 0.74 to 2.11 a week [B43]. The cues also disturbed sleep a little [B43]." @cite="emit('cite', $event)" />

    <template v-if="!training && !sleeping">
      <div class="gchips" role="tablist" aria-label="Part">
        <button type="button" class="gchip" role="tab" :class="{ on: tab === 'train' }" :aria-selected="tab === 'train'" @click="tab = 'train'"><b>Training</b><small>awake, {{ CUE_TRAIN_MIN }} min</small></button>
        <button type="button" class="gchip" role="tab" :class="{ on: tab === 'sleep' }" :aria-selected="tab === 'sleep'" @click="tab = 'sleep'"><b>Sleep</b><small>{{ trainedToday ? `trained at ${hmOf(trainedAt)}` : "train first" }}</small></button>
      </div>

      <div class="glabel">Tone</div>
      <div class="gchips" role="radiogroup" aria-label="Tone">
        <button v-for="(d, id) in CUE_TONES" :key="id" type="button" class="gchip" :class="{ on: id === tone }" role="radio" :aria-checked="id === tone" @click="tone = id; tryTone()"><b>{{ d.label }}</b></button>
      </div>

      <template v-if="tab === 'train'">
        <div class="gbox">
          <div class="t">How it goes</div>
          <p class="gev">The tone plays once a minute, {{ pairings }} times. Each time: do a reality check, then say "next time I hear this, I'll know I'm dreaming".</p>
          <Ev text="20 minutes of training is the laboratory's length [B42]; one pairing a minute is this app's pace. Any cue needs this training first [D5]." @cite="emit('cite', $event)" />
        </div>
      </template>

      <template v-else>
        <div class="glabel">When</div>
        <div class="gchips" role="radiogroup" aria-label="When">
          <button v-for="k in KINDS" :key="k.id" type="button" class="gchip" :class="{ on: k.id === kind }" role="radio" :aria-checked="k.id === kind" :data-kind="k.id" @click="kind = k.id"><b>{{ k.t }}</b><small>{{ k.s }}</small></button>
        </div>
        <template v-if="kind !== 'night'">
          <div class="glabel">First cue after</div>
          <div class="gchips" role="radiogroup" aria-label="First cue after">
            <button v-for="m in CUE_SETTLE_MIN" :key="m" type="button" class="gchip" :class="{ on: m === settle }" role="radio" :aria-checked="m === settle" @click="settle = m"><b>{{ m }} min</b></button>
          </div>
        </template>
        <div class="glabel">A cue every</div>
        <div class="gchips" role="radiogroup" aria-label="A cue every">
          <button v-for="s in CUE_EVERY_SEC" :key="s" type="button" class="gchip" :class="{ on: s === every }" role="radio" :aria-checked="s === every" @click="every = s"><b>{{ s }} s</b></button>
        </div>
        <div class="glabel">Volume</div>
        <div class="gchips" role="radiogroup" aria-label="Volume">
          <button v-for="v in (['softest', 'softer', 'soft'] as const)" :key="v" type="button" class="gchip" :class="{ on: v === volume }" role="radio" :aria-checked="v === volume" @click="volume = v; tryTone()"><b>{{ v[0]!.toUpperCase() + v.slice(1) }}</b></button>
        </div>
        <div class="gbox">
          <div class="t">Cues from {{ hmOf(preview.start) }} to {{ hmOf(preview.end) }}</div>
          <Ev :text="kind === 'night' ? 'At home the app study replayed the cue from 6 hours after training [B43]. The phone can\'t tell when you are in REM, so it plays through the window.' : 'The laboratory played the cue in REM during a morning nap [B42]; the nap studies used a 90-minute nap [D4]. The phone can\'t tell when you are in REM, so it plays through the window.'" @cite="emit('cite', $event)" />
          <p class="gev">The spacing, volume and first-cue delay are this app's own settings: our sources don't give the studies' values. It starts at a whisper and gets no louder than you chose.</p>
          <p v-if="!trainedToday" class="gev">Train first: the cue only works once it means something to you [D5].</p>
        </div>
      </template>

      <div class="gbox">
        <div class="t">Keep in mind</div>
        <p class="gev">{{ limit }}<template v-if="!wake.supported"> This browser can't keep the screen on by itself.</template></p>
        <Ev :text="safetyLines[0]!" @cite="emit('cite', $event)" />
        <p class="gev">If the tone wakes you, make it softer or use it less often.</p>
      </div>
    </template>

    <template v-else-if="training">
      <div class="gbig" aria-live="off">{{ pairing }} / {{ pairings }}</div>
      <div class="gsub">{{ clockText(clock.sec.value) }} of {{ CUE_TRAIN_MIN }}:00</div>
      <p class="glead">At each tone: do a reality check, then say "next time I hear this, I'll know I'm dreaming".</p>
    </template>

    <template v-else>
      <div class="gbig" aria-live="off">{{ played }} cues</div>
      <div class="gsub">{{ cueSession.nextAt.value ? `next at ${hmOf(cueSession.nextAt.value)}` : "" }} · until {{ win ? hmOf(win.end) : "" }}</div>
      <p class="glead">Sleep well. Touch the screen or press a key to stop.</p>
      <p class="gev">{{ cueSession.wakeHeld.value ? "The screen stays on." : "The screen may turn off and stop the sound." }} The app lock may come on; the cues go on behind it.</p>
    </template>
  </div>
  <div class="gfoot">
    <template v-if="!training && !sleeping">
      <button v-if="tab === 'train'" class="btn" @click="startTraining">Start training</button>
      <button v-else class="btn" @click="startSleep">Start the cues</button>
    </template>
    <button v-else-if="training" class="btn o" @click="endTraining(false)">Stop</button>
    <button v-else class="btn o" @click="stopSleep">Stop</button>
  </div>
</template>
