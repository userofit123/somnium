<script setup lang="ts">
// The WBTB planner (PLAN.md §9, LDJ-25): bedtime (the usual one from Settings, or one chosen for tonight) plus whole
// sleep cycles gives the alarm. 3, 4 or 5 cycles (4.5, 6, 7.5 h at 90 min); about 6 h by default, the Erlacher and
// Stumbrys 2020 timing [D13]; 4.5 h or less warns as too early [D14], under 5 h as early (5-6 h is what RESEARCH.md
// §3.4 recommends). 30 minutes up by default (30-60 recommended, RESEARCH.md §3.4 and safety rule 3 [B39]). Saving puts the time on tonight's night (wbtb_wake_at),
// "wbtb" in the plan, and the alarm in this device's reminder plan (native/reminders.ts), with its limits said plainly.
// LDJ-49: a mode switch on top. Short (Aspy: alarm at 5 h, 5-10 minutes up, MILD [D11][D12]), Long (Erlacher and
// Stumbrys 2020: about 6 h, 60 minutes of dream work and MILD [D13]) and LaBerge nap (about 6 h, 60 minutes up, a
// 90-minute nap [D4]); each sets the alarm, the time up and the next step, and the mode goes on the night (wbtb_mode).
import { computed, ref } from "vue";
import { bedtimeAt, durationText, wbtbAfter, wbtbModePlan, isWbtbMode, CYCLE_RANGE, cycleOf, WBTB_CYCLES, WBTB_MODES, WBTB_MODE_DEFS, WBTB_TOO_EARLY_MIN, type WbtbMode } from "@somnium/shared";
import { useSettings } from "../../../api/queries";
import { useJournal } from "../../../api/journal";
import { planWbtb, tonightDate, tonightNight, unplanWbtb } from "../../../api/train";
import { setWbtbAlarm } from "../../../native/reminders";
import { readStr, writeStr } from "../../../core/prefs";
import { toast, toastError } from "../../../core/toast";
import TimePicker from "../../TimePicker.vue";
import NumStep from "../../NumStep.vue";
import Ev from "./Ev.vue";

const emit = defineEmits<{ cite: [ids: string[]]; done: [] }>();
const settings = useSettings();
const j = useJournal();
const date = tonightDate();
const night = computed(() => tonightNight(j.nights.data.value, date));
const hm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

const usual = computed(() => settings.value.sleep.bedtime);
const bed = ref(night.value?.bedtime ? hm(night.value.bedtime) : usual.value);
const cycleLen = ref(cycleOf(Number(readStr("somniumWbtbCycle", "")) || settings.value.sleep.cycle));
const bedAt = computed(() => bedtimeAt(date, bed.value || usual.value));
// the mode: tonight's own when one is planned, else the last one used here, else Long (the tested 6 h timing [D13])
const keptMode = night.value?.wbtbMode ?? readStr("somniumWbtbMode", "long");
const mode = ref<WbtbMode>(isWbtbMode(keptMode) ? keptMode : "long");
const def = computed(() => WBTB_MODE_DEFS[mode.value]);
// an alarm already planned for tonight opens on its own time
const known = night.value?.wbtbWakeAt ? Math.round((new Date(night.value.wbtbWakeAt).getTime() - bedAt.value.getTime()) / 60_000) : 0;
const sleepMin = ref(known >= 60 && known <= 600 ? known : def.value.sleepMin);
const keptAwake = Number(readStr("somniumWbtbAwake", ""));
const awake = ref<number>(def.value.awake.includes(keptAwake) ? keptAwake : def.value.awakeDefault);
function pick(m: WbtbMode) { mode.value = m; sleepMin.value = WBTB_MODE_DEFS[m].sleepMin; awake.value = WBTB_MODE_DEFS[m].awakeDefault; }

// the mode's own time plus whole cycles (4.5, 6, 7.5 h at 90 min), so a cycle-minded person can still choose
const options = computed(() => [...new Set([def.value.sleepMin, sleepMin.value, ...WBTB_CYCLES.map((c) => c * cycleLen.value)])].sort((a, b) => a - b).map((m) => wbtbAfter(bedAt.value, m, cycleLen.value)));
const plan = computed(() => wbtbModePlan(bedAt.value, mode.value, { sleepMin: sleepMin.value, awakeMin: awake.value, cycleMin: cycleLen.value }));
const choice = computed(() => plan.value.alarm);
const planned = computed(() => night.value?.wbtbWakeAt ? hm(night.value.wbtbWakeAt) : null);
const cyclesText = (c: number) => (Number.isInteger(c) ? `${c} cycles` : "");

const AWAKE_EV: Record<WbtbMode, Record<number, string>> = {
  short: {
    5: "Aspy's MILD groups stayed up only as long as the technique took, and still roughly doubled or tripled their lucid dreams [D11][D12].",
    10: "Aspy's MILD groups stayed up only as long as the technique took, and still roughly doubled or tripled their lucid dreams [D11][D12]. Fall asleep soon after: within 10 minutes did better [D12].",
  },
  long: {
    30: "In the laboratory, 30 minutes of dream work and MILD gave 35.7% lucid dreams; an hour gave about 54% [D13].",
    60: "About an hour of dream work and MILD was the most efficient in the laboratory; reading or games instead did little [D13]. It costs more sleep.",
  },
  nap: { 60: "Five times as many people had lucid dreams after 60 minutes up as after 10, and nearly half of all lucid dreams came in naps after 60 minutes awake [D4]." },
};
const NEXT: Record<WbtbMode, string> = {
  short: "When the alarm goes: stay in the dim, recall the dream, do MILD for a few minutes, then go straight back to sleep.",
  long: "When the alarm goes: get up for the hour. Write the dream down, mark its dream signs, rehearse MILD, then back to bed.",
  nap: "When the alarm goes: get up and stay up for an hour, reading about lucid dreaming and testing reality. Then lie down for a 90-minute nap (set a 90-120 minute alarm [D5]) with MILD as you fall asleep.",
};
const desktop = !!(globalThis as any).somniumNative?.reminders;
const perm = ref(typeof Notification === "undefined" ? "unsupported" : Notification.permission);

const busy = ref(false);
async function save() {
  busy.value = true;
  try {
    if (!desktop && perm.value === "default") perm.value = await Notification.requestPermission().catch(() => "default" as NotificationPermission);
    const o = choice.value;
    await planWbtb(o.at, bed.value && bed.value !== usual.value ? bedAt.value : null, mode.value);
    writeStr("somniumWbtbMode", mode.value);
    // kept only when it differs from Settings → Sleep, so that setting stays the default
    writeStr("somniumWbtbCycle", cycleLen.value === cycleOf(settings.value.sleep.cycle) ? "" : String(cycleLen.value));
    writeStr("somniumWbtbAwake", String(awake.value));
    await setWbtbAlarm(o.at.getTime());
    toast(`WBTB alarm set for ${o.wake}`);
    emit("done");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
async function clear() {
  busy.value = true;
  try { await unplanWbtb(); await setWbtbAlarm(null); toast("WBTB alarm cleared"); emit("done"); }
  catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <div class="gbody">
    <h1>Wake back to bed</h1>
    <p class="glead">Sleep first, get up for a while, then go back to bed with MILD or SSILD.</p>

    <div class="glabel">Mode</div>
    <div class="gchips" role="radiogroup" aria-label="Mode">
      <button v-for="m in WBTB_MODES" :key="m" type="button" class="gchip" :class="{ on: m === mode }" role="radio" :aria-checked="m === mode" :data-mode="m" @click="pick(m)">
        <b>{{ WBTB_MODE_DEFS[m].label }}</b><small>{{ durationText(WBTB_MODE_DEFS[m].sleepMin) }} · {{ WBTB_MODE_DEFS[m].awake.join("-") }} min up</small>
      </button>
    </div>
    <Ev :text="def.ev" @cite="emit('cite', $event)" />

    <div class="gbox">
      <div class="grow2">
        <div><div class="t">Bedtime tonight</div><div class="glabel">{{ bed === usual ? "Your usual bedtime" : `Usual ${usual}` }}</div></div>
        <TimePicker v-model="bed" title="Bedtime tonight" />
      </div>
      <div class="grow2">
        <div><div class="t">Sleep cycle</div><div class="glabel">{{ cycleOf(settings.sleep.cycle) }} min is your usual (Settings, Sleep)</div></div>
        <NumStep :value="cycleLen" :min="CYCLE_RANGE.min" :max="CYCLE_RANGE.max" :step="CYCLE_RANGE.step" unit="min" label="Sleep cycle" @set="(v) => (cycleLen = v)" />
      </div>
    </div>

    <div class="glabel">Wake up after</div>
    <div class="gchips" role="radiogroup" aria-label="Wake up after">
      <button v-for="o in options" :key="o.sleepMin" type="button" class="gchip" :class="{ on: o.sleepMin === sleepMin }" role="radio" :aria-checked="o.sleepMin === sleepMin" @click="sleepMin = o.sleepMin">
        <b>{{ o.wake }}</b><small>{{ durationText(o.sleepMin) }}<template v-if="cyclesText(o.cycles)"> · {{ cyclesText(o.cycles) }}</template></small>
      </button>
    </div>
    <Ev v-if="choice.timing === 'ok'" text="About 6 hours of sleep is the tested timing: Erlacher and Stumbrys woke people from REM after about 6 hours [D13]. Later is fine if you can sleep in." @cite="emit('cite', $event)" />
    <div v-else-if="choice.timing === 'too-early'" class="gbox gwarn">
      <div class="t">{{ durationText(WBTB_TOO_EARLY_MIN) }} or less is too early</div>
      <Ev text="Waking at 4.5 hours, the follow-up study concluded that &quot;the earlier sleep interruption seems to reduce the lucid dream induction rate&quot; [D14]. Choose a later time if you can." @cite="emit('cite', $event)" />
    </div>
    <div v-else class="gbox gwarn">
      <div class="t">Under 5 h is early</div>
      <Ev text="5-6 hours of sleep before waking is what's recommended: the tested timing was about 6 hours, and waking at 4.5 hours did less well [B39][B40]. Choose a later time if you can." @cite="emit('cite', $event)" />
    </div>

    <div class="glabel">Time awake</div>
    <div class="gchips" role="radiogroup" aria-label="Time awake">
      <button v-for="m in def.awake" :key="m" type="button" class="gchip" :class="{ on: m === awake }" role="radio" :aria-checked="m === awake" @click="awake = m">
        <b>{{ m }} min</b><small>back in bed {{ hm(new Date(choice.at.getTime() + m * 60_000).toISOString()) }}</small>
      </button>
    </div>
    <Ev v-if="AWAKE_EV[mode][awake]" :text="AWAKE_EV[mode][awake]!" @cite="emit('cite', $event)" />

    <div class="gbox">
      <div class="t">Next</div>
      <Ev :text="NEXT[mode]" @cite="emit('cite', $event)" />
      <p v-if="plan.napEnd" class="gev">Nap from about {{ hm(plan.backAt.toISOString()) }} to {{ hm(plan.napEnd.toISOString()) }}.</p>
    </div>
    <Ev text="Sleep comes first: only on nights when you can sleep in afterwards, two or three nights a week at most [B69][D1]." @cite="emit('cite', $event)" />

    <div class="gbox">
      <div class="t">About the alarm</div>
      <p v-if="desktop" class="gev">The desktop app shows it while Somnium is running, with the window in the background too. It can't wake a computer that is asleep.</p>
      <p v-else class="gev">A browser shows it only while Somnium is open in a tab or as the installed app (in the background too); it can't wake a closed page.<template v-if="perm === 'denied'"> Notifications are blocked for this site, so no alarm will show.</template></p>
      <p class="gev">An alarm that rings on your phone with the app closed needs the Android app, which isn't out yet. Until then, set your phone's own alarm for {{ choice.wake }} too.</p>
    </div>
  </div>
  <div class="gfoot">
    <button class="btn" :disabled="busy" @click="save">Set the alarm for {{ choice.wake }}</button>
    <button v-if="planned" type="button" class="glink" :disabled="busy" @click="clear">Clear tonight's alarm ({{ planned }})</button>
  </div>
</template>
