<script setup lang="ts">
// The bedtime routine (LDJ-167), where the bedtime reminder opens (packages/shared/src/reminders.ts nightUrl): about two
// minutes on the dim night surface, for every night, WBTB or not. 1. Tonight's intention: the night's own, else the one
// the lesson suggests (packages/shared/src/tonight.ts: recall first in lessons 1-2, LaBerge's intention to remember
// dreams [C1][C2]). 2. From lesson 3, the top dream sign and "next time I see it, I'll know I'm dreaming", the dream
// sign step of MILD [D1] and Tholey's intention technique [D6]. 3. Tonight's plan and the WBTB alarm, to confirm or
// change in Train > Tonight. Then it hands over to the planned technique's guided screen (MILD, SSILD, WILD), or the
// screen goes dark with "Sleep well". Either way "intention" is logged as done on the night (plain techniques_done).
// The intention is sealed (saved through api/home.ts like MildFlow's); the sign's name shows only here, behind the app
// lock like all of Train, never in the reminder.
import { computed, ref } from "vue";
import { COURSE_LESSONS, currentLesson, freeNightsOf, signShortlist, suggestTonight, wbtbNightsOf, TECHNIQUES } from "@somnium/shared";
import { useSigns } from "../../signs/useSigns";
import { useJournal } from "../../../api/journal";
import { saveIntention } from "../../../api/home";
import { logTechniqueDone, tonightDate, useCourse } from "../../../api/train";
import { useSettings } from "../../../api/queries";
import { useFmt } from "../../../core/format";
import { toastError } from "../../../core/toast";
import { useWakeLock } from "./useGuided";
import type { GuidedMode } from "./GuidedView.vue";
import Ev from "./Ev.vue";

const emit = defineEmits<{ cite: [ids: string[]]; done: []; go: [mode: GuidedMode]; running: [on: boolean] }>();
const settings = useSettings();
const fmt = useFmt();
const j = useJournal();
const course = useCourse();
const { elements, stats, dreams, today } = useSigns();
const date = tonightDate();
const night = computed(() => j.nights.data.value?.find((n) => n.date === date && !n.nap));

// the lesson decides the intention and whether the dream sign step is there (from lesson 3, "reality-checks")
const lesson = computed(() => (course.data.value ? currentLesson(course.data.value) : null));
const lessonAt = computed(() => (lesson.value === null ? COURSE_LESSONS.length : Math.max(0, (COURSE_LESSONS as readonly string[]).indexOf(lesson.value))));
const suggested = computed(() => {
  const s = settings.value;
  return suggestTonight({ lesson: lesson.value, date, freeNights: freeNightsOf(s.sleep.freeNights), sleepFirst: s.safety.sleepFirst, safetyChecked: s.safety.checked, wbtbNights: wbtbNightsOf(j.nights.data.value ?? [], date) }).intention;
});
const saved = computed(() => night.value?.intention?.trim() || "");
const edited = ref<string | null>(null);
const text = computed({ get: () => edited.value ?? (saved.value || suggested.value), set: (v: string) => { edited.value = v; } });
const withSign = computed(() => lessonAt.value >= 2);
const top = computed(() => signShortlist(elements.value, stats.value, dreams.value, [], today.value, 1)[0]?.element.name ?? null);

// tonight's plan: WBTB is the alarm row, the rest the techniques; the first with a guided screen takes over at the end
const GUIDED: Record<string, GuidedMode> = { mild: "mild", ssild: "ssild", wild: "wild" };
const planned = computed(() => (night.value?.techniquesPlanned ?? []).filter((id) => id !== "wbtb"));
const names = computed(() => planned.value.map((id) => TECHNIQUES.find((t) => t.id === id)?.label ?? id));
const next = computed((): GuidedMode | null => planned.value.map((id) => GUIDED[id]).find((m): m is GuidedMode => !!m) ?? null);
const alarm = computed(() => night.value?.wbtbWakeAt ?? null);

const steps = computed(() => (withSign.value ? ["intention", "sign", "plan"] : ["intention", "plan"]) as ("intention" | "sign" | "plan")[]);
const step = ref(0);
const at = computed(() => steps.value[Math.min(step.value, steps.value.length - 1)]!);
const last = computed(() => step.value >= steps.value.length - 1);
const wake = useWakeLock();
void wake.on();

const busy = ref(false), dark = ref(false);
async function forward() {
  if (at.value === "intention" && edited.value !== null && edited.value.trim() !== (saved.value || suggested.value)) {
    busy.value = true;
    try { await saveIntention(date, edited.value); } catch (e) { toastError(e); return; } finally { busy.value = false; }
  }
  if (!last.value) { step.value++; return; }
  await finish(next.value);
}
// done either way: the intention was set tonight. Logged on the night through the outbox, so it waits offline.
async function finish(to: GuidedMode | null) {
  busy.value = true;
  try { await logTechniqueDone("intention", date); } catch (e) { toastError(e); } finally { busy.value = false; }
  if (to) { emit("go", to); return; }
  dark.value = true;
  emit("running", true);
  await wake.off();
}
const label = (m: GuidedMode) => ({ mild: "Start MILD", ssild: "Start SSILD", wild: "Start WILD" } as Record<string, string>)[m] ?? "Next";
</script>

<template>
  <template v-if="!dark">
    <div class="gbody">
      <div class="gsteps" aria-hidden="true"><i v-for="(s, i) in steps" :key="s" :class="{ on: i === step }" /></div>
      <template v-if="at === 'intention'">
        <h1>Tonight's intention</h1>
        <p class="gp">Lie down, settle, and say it to yourself a few times, meaning it:</p>
        <label class="glabel" for="b-intention">Intention</label>
        <textarea id="b-intention" v-model="text" class="gintent" rows="3" maxlength="200" />
        <Ev v-if="!withSign" text="Deciding before sleep that you will remember your dreams is the first step of building recall [C1][C2]. Changing it saves it, sealed, as tonight's intention." @cite="emit('cite', $event)" />
        <Ev v-else text="Setting a clear intention to recognise the dream as you fall asleep is the core of MILD and Tholey's intention technique [D1][D6]. Changing it saves it, sealed, as tonight's intention." @cite="emit('cite', $event)" />
      </template>
      <template v-else-if="at === 'sign'">
        <h1>Your dream sign</h1>
        <div v-if="top" class="gbox"><div class="glabel">Your top dream sign</div><div class="gsign">{{ top }}</div><div class="gev">Next time I see it, I'll know I'm dreaming.</div></div>
        <p v-else class="gev">Your top dream sign shows here once the Journal has enough dreams to find one. Picture whatever would tell you it is a dream.</p>
        <p class="glead">Picture it in a dream, notice it, and know: this is a dream.</p>
        <Ev text="Looking out for your own dream signs and imagining recognising one is how MILD uses them [D1][C1]." @cite="emit('cite', $event)" />
      </template>
      <template v-else>
        <h1>Tonight's plan</h1>
        <div class="gbox">
          <div><div class="glabel">Technique</div><div class="t">{{ names.length ? names.join(" · ") : "Nothing planned" }}</div></div>
          <div><div class="glabel">WBTB alarm</div><div class="t">{{ alarm ? fmt.time(alarm) : "No alarm" }}</div></div>
        </div>
        <p class="gev">Not right? <router-link to="/train/tonight">Change tonight's plan</router-link></p>
        <p v-if="!next" class="gp">Then put the phone away and let yourself drift off with the intention.</p>
      </template>
    </div>
    <div class="gfoot">
      <button class="btn" :disabled="busy" @click="forward">{{ !last ? "Next" : next ? label(next) : "Sleep now" }}</button>
      <button v-if="last && next" type="button" class="glink" :disabled="busy" @click="finish(null)">Just sleep</button>
      <button v-if="step > 0" type="button" class="glink" @click="step--">Back</button>
    </div>
  </template>
  <template v-else>
    <div class="gbody" role="status"><h1>Sleep well</h1></div>
    <div class="gfoot"><button type="button" class="glink" @click="emit('done')">Close</button></div>
  </template>
</template>
