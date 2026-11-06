<script setup lang="ts">
// The WBTB planner (PLAN.md §9, LDJ-25): bedtime (the usual one from Settings, or one chosen for tonight) plus whole
// sleep cycles gives the alarm. 3, 4 or 5 cycles (4.5, 6, 7.5 h at 90 min); about 6 h by default, the Erlacher and
// Stumbrys 2020 timing [D13]; a warning under 4.5 h [D14]. Saving puts the time on tonight's night (wbtb_wake_at),
// "wbtb" in the plan, and the alarm in this device's reminder plan (native/reminders.ts), with its limits said plainly.
import { computed, ref } from "vue";
import { bedtimeAt, defaultCycles, durationText, wbtbOption, wbtbOptions, CYCLE_MIN, CYCLE_RANGE, WBTB_AWAKE, WBTB_EARLY_MIN } from "@somnium/shared";
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
const cycleLen = ref(Number(readStr("somniumWbtbCycle", String(CYCLE_MIN))) || CYCLE_MIN);
const bedAt = computed(() => bedtimeAt(date, bed.value || usual.value));
// an alarm already planned for tonight opens on its own cycle count
const known = night.value?.wbtbWakeAt ? Math.round((new Date(night.value.wbtbWakeAt).getTime() - bedAt.value.getTime()) / 60_000 / cycleLen.value) : 0;
const cycles = ref(known >= 1 && known <= 6 ? known : defaultCycles(cycleLen.value));
const awake = ref(WBTB_AWAKE.includes(Number(readStr("somniumWbtbAwake", "30")) as never) ? Number(readStr("somniumWbtbAwake", "30")) : 30);

const options = computed(() => wbtbOptions(bedAt.value, cycleLen.value, cycles.value < 3 || cycles.value > 5 ? [cycles.value] : []));
const choice = computed(() => wbtbOption(bedAt.value, cycles.value, cycleLen.value));
const planned = computed(() => night.value?.wbtbWakeAt ? hm(night.value.wbtbWakeAt) : null);

const AWAKE_EV: Record<number, string> = {
  10: "Enough for MILD: in Aspy's studies people stayed up only as long as MILD took and still doubled or tripled their rate [D11][D12].",
  30: "In the laboratory, 30 minutes of dream work and MILD gave 35.7% lucid dreams; an hour gave about 54% [D13].",
  60: "About an hour of dream work and MILD was the most efficient in the laboratory; reading or games instead did little [D13]. It costs more sleep.",
};
const desktop = !!(globalThis as any).somniumNative?.reminders;
const perm = ref(typeof Notification === "undefined" ? "unsupported" : Notification.permission);

const busy = ref(false);
async function save() {
  busy.value = true;
  try {
    if (!desktop && perm.value === "default") perm.value = await Notification.requestPermission().catch(() => "default" as NotificationPermission);
    const o = choice.value;
    await planWbtb(o.at, bed.value && bed.value !== usual.value ? bedAt.value : null);
    writeStr("somniumWbtbCycle", String(cycleLen.value));
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

    <div class="gbox">
      <div class="grow2">
        <div><div class="t">Bedtime tonight</div><div class="glabel">{{ bed === usual ? "Your usual bedtime" : `Usual ${usual}` }}</div></div>
        <TimePicker v-model="bed" title="Bedtime tonight" />
      </div>
      <div class="grow2">
        <div><div class="t">Sleep cycle</div><div class="glabel">90 min for most people</div></div>
        <NumStep :value="cycleLen" :min="CYCLE_RANGE.min" :max="CYCLE_RANGE.max" :step="CYCLE_RANGE.step" unit="min" label="Sleep cycle" @set="(v) => (cycleLen = v)" />
      </div>
    </div>

    <div class="glabel">Wake up after</div>
    <div class="gchips" role="radiogroup" aria-label="Wake up after">
      <button v-for="o in options" :key="o.cycles" type="button" class="gchip" :class="{ on: o.cycles === cycles }" role="radio" :aria-checked="o.cycles === cycles" @click="cycles = o.cycles">
        <b>{{ o.wake }}</b><small>{{ durationText(o.sleepMin) }} · {{ o.cycles }} cycles</small>
      </button>
    </div>
    <Ev v-if="!choice.early" text="About 6 hours of sleep is the tested timing: Erlacher and Stumbrys woke people from REM after about 6 hours [D13]. Later is fine if you can sleep in." @cite="emit('cite', $event)" />
    <div v-else class="gbox gwarn">
      <div class="t">Under {{ durationText(WBTB_EARLY_MIN) }} is early</div>
      <Ev text="Waking at 4.5 hours, the follow-up study concluded that &quot;the earlier sleep interruption seems to reduce the lucid dream induction rate&quot; [D14]. Choose a later time if you can." @cite="emit('cite', $event)" />
    </div>

    <div class="glabel">Time awake</div>
    <div class="gchips" role="radiogroup" aria-label="Time awake">
      <button v-for="m in WBTB_AWAKE" :key="m" type="button" class="gchip" :class="{ on: m === awake }" role="radio" :aria-checked="m === awake" @click="awake = m">
        <b>{{ m }} min</b><small>{{ m === 10 ? "short" : "long" }}</small>
      </button>
    </div>
    <Ev :text="AWAKE_EV[awake]!" @cite="emit('cite', $event)" />
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
