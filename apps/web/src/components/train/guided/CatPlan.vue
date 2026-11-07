<script setup lang="ts">
// The CAT plan (LDJ-49): Daniel Love's Cycle Adjustment Technique [D24], anecdotal evidence as the library marks it.
// Stage 1: 7 mornings of waking 90 minutes early and staying up 90 minutes, a reality check every 2-5 minutes. Stage
// 2: alternate Day A (alarm at the normal time; the intention to reality test at the early time) and Day B (Stage 1's
// routine), without missing days. The plan is kept on this device and sets each morning's alarm through the night
// reminders (native/reminders.ts setCatPlan); "Done this morning" logs "cat" on the night (techniques_done, wbtb_mode).
import { computed, ref } from "vue";
import { catDay, catSchedule, CAT } from "@somnium/shared";
import { evidenceLabel, findTechnique } from "@somnium/knowledge/techniques";
import { useSettings } from "../../../api/queries";
import { logTechniqueDone, nightNowDate, tonightDate } from "../../../api/train";
import { catPlan, setCatPlan } from "../../../native/reminders";
import { localYmd } from "../../../core/format";
import { toast, toastError } from "../../../core/toast";
import TimePicker from "../../TimePicker.vue";
import Ev from "./Ev.vue";

const emit = defineEmits<{ cite: [ids: string[]]; done: [] }>();
const settings = useSettings();
const plan = ref(catPlan());
const wake = ref(plan.value?.wake ?? settings.value.sleep.wake ?? "07:00");
// the first CAT morning: the one tonight is filed under
const start = computed(() => plan.value?.start ?? tonightDate());
const days = computed(() => catSchedule(start.value, wake.value, 14, plan.value ? localYmd(new Date()) : start.value));
const today = computed(() => (plan.value ? catDay(plan.value.start, nightNowDate(), plan.value.wake) : null));
const basis = findTechnique("cat")?.basis ?? "";
const desktop = !!(globalThis as any).somniumNative?.reminders;
const busy = ref(false);
const label = (d: { stage: number; letter: string | null; kind: string }) => d.stage === 1 ? "Stage 1 · up early" : d.letter === "A" ? "Day A · normal time" : "Day B · up early";
const dayName = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

async function begin() {
  busy.value = true;
  try {
    if (!desktop && typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission().catch(() => {});
    const p = { start: start.value, wake: wake.value };
    await setCatPlan(p); plan.value = p;
    toast(`CAT started · first alarm ${days.value[0]?.alarm ?? ""}`);
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
async function stop() {
  busy.value = true;
  try { await setCatPlan(null); plan.value = null; toast("CAT stopped"); } catch (e) { toastError(e); } finally { busy.value = false; }
}
async function doneToday() {
  busy.value = true;
  try { await logTechniqueDone("cat", nightNowDate(), "cat"); toast("Logged on the night"); emit("done"); } catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <div class="gbody">
    <h1>CAT plan</h1>
    <p class="glead">Daniel Love's Cycle Adjustment Technique: train your body to expect waking early, then let it sleep through the extra REM.</p>
    <div class="gbox">
      <div class="t">{{ evidenceLabel.anecdotal }}</div>
      <Ev :text="basis + ' Love reports that 8 of 10 of his students had a lucid dream within two weeks; he says it has not been researched enough for a success rate [D24].'" @cite="emit('cite', $event)" />
    </div>

    <div class="gbox">
      <div class="grow2">
        <div><div class="t">Normal wake time</div><div class="glabel">Keep bedtime and wake time fixed</div></div>
        <TimePicker v-if="!plan" v-model="wake" title="Normal wake time" />
        <b v-else>{{ plan.wake }}</b>
      </div>
    </div>
    <Ev :text="`Stage 1, ${CAT.stage1Days} days: the alarm ${CAT.earlyMin} minutes early; get up and stay up ${CAT.upMin} minutes, a reality check every ${CAT.checkEveryMin[0]}-${CAT.checkEveryMin[1]} minutes. Stage 2: alternate Day A (alarm at the normal time, intend to reality test at the early time; if you wake then, lie still and try for a lucid dream) and Day B (Stage 1 again). Don't miss days; if you stop, start again from Stage 1 [D24].`" @cite="emit('cite', $event)" />

    <div v-if="today" class="gbox">
      <div class="t">This morning: day {{ today.day }} · {{ label(today) }}</div>
    </div>
    <div class="glabel">{{ plan ? "Coming mornings" : "The first two weeks" }}</div>
    <div class="gbox">
      <div v-for="d in days" :key="d.date" class="grow2" :data-cat-day="d.day">
        <div><div class="t">{{ dayName(d.date) }}</div><div class="glabel">Day {{ d.day }} · {{ label(d) }}</div></div>
        <b>{{ d.alarm }}</b>
      </div>
    </div>
    <p class="gev">The alarm comes through the night reminders on this device: <template v-if="desktop">while the desktop app runs</template><template v-else>only while Somnium is open in a tab or as the installed app; the Android app rings like an alarm</template>. Set your phone's own alarm too.</p>
    <Ev text="It trades unbroken sleep for timing; skip it if you can't keep the schedule or sleep suffers [D24][B69]." @cite="emit('cite', $event)" />
  </div>
  <div class="gfoot">
    <button v-if="!plan" class="btn" :disabled="busy" @click="begin">Start CAT</button>
    <template v-else>
      <button class="btn" :disabled="busy" @click="doneToday">Done this morning</button>
      <button type="button" class="glink" :disabled="busy" @click="stop">Stop CAT</button>
    </template>
  </div>
</template>
