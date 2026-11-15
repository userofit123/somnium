<script setup lang="ts">
// The first-run setup (LDJ-77): a few short steps after the account is made, so day one has a plan instead of an empty,
// unexplained app. Each step is skippable, with Back, and one primary button. Every answer goes through the normal
// write paths (settings, the reminders rows, the course and tonight's night: outbox and live topics), so it syncs
// and every screen updates; nothing here is sealed. The safety check's answers are the exception: they stay on the
// device (safety.ts), and only their outcome syncs. Shown by App.vue only behind an open lock (useSetup.ts).
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { DEFAULT_RC_SCHEDULE, PER_DAY_MAX, PER_DAY_MIN, nightRow, rcSchedule, type CourseLesson, type CourseProgress, type SetupExperience, type SetupGoal } from "@somnium/shared";
import { assessments } from "@somnium/knowledge/assessments";
import { useSettings, saveSettings } from "../../api/queries";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { setLesson, planTonight } from "../../api/train";
import { REMINDERS_KEY, fetchReminders, rcRow, putRcReminder, putNightReminder, androidReminders } from "../../native/reminders";
import { askNotificationPermission } from "../../native/notifications";
import { toastError } from "../../core/toast";
import { useFmt, localYmd } from "../../core/format";
import { saveAnswer } from "../../core/learn";
import { setupOnly, setupRun, setupStep as step } from "./useSetup";
import { SAFETY_ITEMS, keepSafetyAnswers, safetyAnswers, type SafetyItem } from "./safety";
import { parseInline } from "@somnium/knowledge/markdown";
import LearnInline from "../learn/LearnInline.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import Logo from "../../shell/Logo.vue";
import ChoiceTiles from "../ChoiceTiles.vue";
import TimePicker from "../TimePicker.vue";
import NumStep from "../NumStep.vue";
import FreeNights from "../settings/FreeNights.vue";

const router = useRouter();
const settings = useSettings();
const rows = useQuery({ queryKey: [...REMINDERS_KEY], queryFn: fetchReminders, staleTime: 30_000 });
const course = useQuery({ queryKey: ["course"], queryFn: () => api.get<CourseProgress[]>("/course") });
// once it shows it stays until the person leaves it, even after "done" is saved on the last step
onMounted(() => { setupRun.value = true; });

// The steps in order. The safety check comes before "technique", so tonight's suggestion already follows it.
const STEPS = ["experience", "goal", "recall", "sleep", "freeNights", "reminders", "safety", "technique", "extras"] as const;
type StepId = (typeof STEPS)[number] | "done";
const at = computed<StepId>(() => STEPS[step.value] ?? "done");
const busy = ref(false);
// one step on its own (setupOnly: the safety check from Settings or the WBTB planner) opens on that step
watch(setupOnly, (id) => { const i = STEPS.indexOf(id as (typeof STEPS)[number]); if (i >= 0) step.value = i; }, { immediate: true });

// 1. experience: picks the course lesson to start on
const experience = ref<SetupExperience>(settings.value.setup.experience || "new");
const LESSON: Record<Exclude<SetupExperience, "">, CourseLesson> = { new: "recall", some: "reality-checks", regular: "mild-wbtb" };
const EXPERIENCES = [
  { value: "new", label: "New to it", hint: "Starts with dream recall: a week of journaling first", icon: "sparkle" },
  { value: "some", label: "A few lucid dreams", hint: "Starts with dream signs and reality checks", icon: "moon" },
  { value: "regular", label: "Regular lucid dreamer", hint: "Starts with MILD and WBTB", icon: "star" },
];
// someone already on the course (setup run again) keeps their place
const onCourse = computed(() => !!course.data.value?.length);

// 2. the goal (LDJ-180): what the person wants from it, kept in settings.setup.goal. A plain choice; nothing preset.
const goal = ref<SetupGoal>(settings.value.setup.goal);
const GOALS = [
  { value: "first", label: "My first lucid dream", icon: "sparkle" },
  { value: "often", label: "Lucid dreams more often", icon: "moon" },
  { value: "longer", label: "Longer, clearer lucid dreams", icon: "star" },
  { value: "recall", label: "Remember more of my dreams", icon: "book" },
];

// 3. where recall starts (LDJ-180): Learn's "Where am I" dream recall question (MADRE [B50]), kept as a dated answer
// like any other and in settings.setup.recall, the starting point Progress · Recall and Home set today against
const MADRE = assessments.madre;
const recall = ref<number | null>(settings.value.setup.recall);
const RECALLS = [...MADRE.options].reverse().map((o) => ({ value: o.value, label: o.label }));
const recallNote = "The dream recall question of the Mannheim Dream Questionnaire [B50]. Progress · Recall sets what your journal shows against it; Learn · Where am I keeps it with the date.";

// 4. usual sleep times
const bedtime = ref(settings.value.sleep.bedtime), wake = ref(settings.value.sleep.wake);

// 6. reminders: on by default here when nothing is saved, so the first morning has its prompt (NIGHT_DEFAULT_ON keeps
// them off elsewhere). Saved rows win, so running setup again never overwrites what the person chose.
const rc = computed(() => rcSchedule(rcRow(rows.data.value)?.schedule ?? DEFAULT_RC_SCHEDULE));
const rcOn = ref(true), perDay = ref(DEFAULT_RC_SCHEDULE.perDay), morning = ref(true), bed = ref(true);
let seeded = false;
watch(() => rows.data.value, (rs) => {
  if (seeded || !rs) return; // the list arrives after the screen; take it once, before the person edits
  seeded = true;
  const r = rcRow(rs);
  if (r) { rcOn.value = !!r.enabled; perDay.value = rc.value.perDay; }
  for (const [kind, flag] of [["morning_journal", morning], ["bedtime", bed]] as const)
    if (rs.some((x) => x.kind === kind && !x.deletedAt)) flag.value = nightRow(rs, kind).on;
}, { immediate: true });
const desktopApp = !!(globalThis as any).somniumNative?.reminders;
const limits = desktopApp ? "They come while Somnium is running, in the tray too."
  : androidReminders() ? "Android shows them on time, also with the app closed."
  : "A browser shows them only while Somnium is open in a tab or as an installed app; on a phone, the Android app is reliable.";

// 7. the safety check (LDJ-116, Learn's "Who should be careful" and "Sleep first"): plain yes/no items. A yes keeps
// WBTB, the CAT alarm and naps out of suggestions (settings.safety.sleepFirst, synced) and shows the matching safety
// page once in "For you". The answers themselves stay on this device (safety.ts). Calm wording: advice, not a verdict.
const safe = ref<SafetyItem[]>([...safetyAnswers.value]);
// the answers open a moment after the lock does (sealed, safety.ts): take them if nothing is ticked yet
watch(safetyAnswers, (v) => { if (!safe.value.length) safe.value = [...v]; });
const health = computed(() => safe.value.some((x) => x !== "alert"));
const sleepFirst = computed(() => settings.value.safety.sleepFirst);
// Sources as buttons that open the source sheet, the way the guided screens do (train/guided/Ev.vue). Advice to talk
// to someone first cites only the sources for what was a yes (RESEARCH.md Part B §6.2).
const cite = ref<string[] | null>(null);
const cites = (ids: readonly string[]) => [...new Set(ids)].map((id) => `[${id}]`).join("");
const SAFETY_LEDE = "So Somnium suggests only what suits you. The research advises a few people to go slowly, or to talk to a doctor first [B69][B70][B72]. Does any of these apply to you now?";
const safetyNote = computed(() => {
  const why = "Thanks for saying. Somnium will leave wake back to bed, the CAT alarm and naps out of its suggestions, since they break up sleep [B69][B70], and Home will show a short page to read.";
  const asked = SAFETY_ITEMS.filter((x) => x.id !== "alert" && safe.value.includes(x.id)).flatMap((x) => x.sources);
  return health.value
    ? `${why} Before you practise, it's worth talking it over with a doctor or therapist ${cites(asked)}.`
    : `${why} Lucid dreaming needs good sleep; if you find you are losing sleep, let it go for a while [D1].`;
});
const techniqueNote = computed(() => "In the largest home study, MILD and SSILD did about equally well (about 16 to 20% of nights with a lucid dream), both done after waking in the night (Aspy 2020) [B38]."
  + (sleepFirst.value ? " With sleep first, do it as you fall asleep at bedtime, without an alarm in the night." : ""));

// 8. tonight's technique
const technique = ref("mild");
const TECHS = [
  { value: "mild", label: "MILD", hint: "Suggested: rehearse becoming lucid as you fall asleep" },
  { value: "ssild", label: "SSILD", hint: "Cycle through sight, sound and touch" },
  { value: "", label: "Nothing yet", hint: "Just the journal tomorrow morning" },
];

// 9. extras: the optional features most people want, switched on here instead of in Settings → Features, and the
// Next lesson block on Home (Edit home's switch, settings.home.blocks; not a feature)
const EXTRAS = [
  { value: "goals", label: "Goals", hint: "A lucid dream a week, a full journal month" },
  { value: "weekReview", label: "Weekly review", hint: "Two minutes on the last evening of your week, to plan the next" },
  { value: "dayNotes", label: "Day notes", hint: "A line about your day, to spot it in dreams later" },
  { value: "photos", label: "Photos", hint: "Add photos, read a paper journal page" },
  { value: "homeLesson", label: "Next lesson on Home", hint: "The lesson you are on, on Home" },
];
const LESSON_BLOCK = "lesson";
const extras = ref<string[]>(EXTRAS.map((e) => e.value).filter((k) => k === "homeLesson" ? settings.value.home.blocks.some((b) => b.id === LESSON_BLOCK && b.on) : settings.value.features[k]));

/** Saves the step's answers, then moves on. Skip moves on without saving. */
async function next() {
  busy.value = true;
  try {
    if (at.value === "experience") {
      void saveSettings({ setup: { experience: experience.value } }, { quiet: true });
      if (!onCourse.value && experience.value) await setLesson(LESSON[experience.value], "active");
    } else if (at.value === "goal") {
      void saveSettings({ setup: { goal: goal.value } }, { quiet: true });
    } else if (at.value === "recall") {
      if (recall.value != null) {
        // one answer a day: running the setup again the same day replaces it instead of adding another
        // compared before saving, which updates settings at once; unchanged means no duplicate dated answer in Learn history
        const changed = recall.value !== settings.value.setup.recall;
        void saveSettings({ setup: { recall: recall.value } }, { quiet: true });
        if (changed) void saveAnswer("madre", settings.value.learn.assessments.madre, recall.value, { quiet: true });
      }
    } else if (at.value === "sleep") {
      void saveSettings({ sleep: { bedtime: bedtime.value, wake: wake.value } }, { quiet: true });
    } else if (at.value === "reminders") {
      // the browser and Android ask only now, when a reminder is switched on
      if ((rcOn.value || morning.value || bed.value) && !desktopApp) await askNotificationPermission();
      const rs = rows.data.value;
      await putRcReminder(rs, { ...rc.value, perDay: perDay.value }, rcOn.value);
      await putNightReminder(rs, "morning_journal", nightRow(rs, "morning_journal").s, morning.value);
      await putNightReminder(rs, "bedtime", nightRow(rs, "bedtime").s, bed.value);
      invalidate(["reminders"]);
    } else if (at.value === "safety") {
      keepSafetyAnswers(safe.value);
      void saveSettings({ safety: { checked: true, sleepFirst: safe.value.length > 0 } }, { quiet: true });
    } else if (at.value === "technique") {
      // tonight's plan is all: the bedtime reminder reads its technique from there (native/reminders.ts nightPlans)
      if (technique.value) await planTonight(technique.value, true);
    } else if (at.value === "extras") {
      const lessonOn = extras.value.includes("homeLesson");
      void saveSettings({
        features: Object.fromEntries(EXTRAS.filter((e) => e.value !== "homeLesson").map((e) => [e.value, extras.value.includes(e.value)])),
        home: { blocks: settings.value.home.blocks.map((b) => (b.id === LESSON_BLOCK ? { ...b, on: lessonOn } : b)) },
      }, { quiet: true });
    }
  } catch (e) { toastError(e); return; } finally { busy.value = false; }
  skip();
}
function skip() {
  if (setupOnly.value) return close();
  step.value++;
  if (at.value === "done") void saveSettings({ setup: { done: true } }, { quiet: true });
}
// 5. the nights a lie-in is possible save on every tap (FreeNights, the Settings · Sleep row), so Next only moves on
const FREE_NIGHTS_LEDE = "The evenings before a morning without an early alarm. Tonight's plan suggests wake back to bed only on these, since it breaks up sleep [B69].";

// The done screen says once what "Automatic" formats became on this device (LDJ-193), with a way to change them
const fmt = useFmt();
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const formats = computed(() => {
  const f = fmt.value;
  return `${f.date(localYmd(new Date()), { weekday: "long", day: "numeric", month: "short", year: "numeric" })} · ${f.s.clock}-hour clock · weeks start on ${DAYS[f.s.firstDay]}`;
});

function skipAll() { step.value = STEPS.length; void saveSettings({ setup: { done: true } }, { quiet: true }); }
function back() { if (step.value > 0) step.value--; }
function close() { setupRun.value = false; setupOnly.value = null; step.value = 0; }
function finish(to: string) { close(); void router.push(to); }
</script>

<template>
  <div class="auth" role="main">
    <div class="card su">
      <Logo />
      <p v-if="at !== 'done' && !setupOnly" class="tiny su-count">Step {{ step + 1 }} of {{ STEPS.length }}</p>

      <template v-if="at === 'experience'">
        <h1>Welcome to Somnium</h1>
        <p class="muted su-lede">A minute to set up your first night. How much lucid dreaming have you done?</p>
        <ChoiceTiles v-model="experience" :options="EXPERIENCES" :cols="1" label="Experience" />
        <p v-if="onCourse" class="tiny su-gap">You are on the course already; your lesson stays as it is.</p>
      </template>

      <template v-else-if="at === 'goal'">
        <h1>Your goal</h1>
        <p class="muted su-lede">What would you most like from lucid dreaming?</p>
        <ChoiceTiles v-model="goal" :options="GOALS" :cols="1" label="Goal" />
      </template>

      <template v-else-if="at === 'recall'">
        <h1>Where you start</h1>
        <p class="muted su-lede">How often do you wake remembering a dream?</p>
        <ChoiceTiles v-model="recall" :options="RECALLS" :cols="1" label="Dream recall" />
        <p class="tiny su-gap"><LearnInline :nodes="parseInline(recallNote)" @cite="cite = $event" /></p>
      </template>

      <template v-else-if="at === 'sleep'">
        <h1>Your sleep</h1>
        <p class="muted su-lede">Reminders, tonight's plan and the WBTB alarm follow these. Change them any time in Settings · Sleep.</p>
        <div class="frow">
          <div class="fld"><label>I usually go to bed at</label><TimePicker v-model="bedtime" title="Bedtime" /></div>
          <div class="fld"><label>I usually wake at</label><TimePicker v-model="wake" title="Wake time" /></div>
        </div>
      </template>

      <template v-else-if="at === 'freeNights'">
        <h1>Nights you can sleep in</h1>
        <p class="muted su-lede"><LearnInline :nodes="parseInline(FREE_NIGHTS_LEDE)" @cite="cite = $event" /></p>
        <FreeNights quiet />
        <p class="tiny su-gap">None picked: no WBTB suggestions. Change them any time in Settings · Sleep.</p>
      </template>

      <template v-else-if="at === 'reminders'">
        <h1>Reminders</h1>
        <p class="muted su-lede">Nothing from your journal is ever in them.</p>
        <label class="tgl"><div class="grow"><div class="t">Morning journal</div><div class="s">At your wake time: "Write your dream"</div></div><span class="tg"><input v-model="morning" type="checkbox" /></span></label>
        <label class="tgl"><div class="grow"><div class="t">Bedtime</div><div class="s">15 min before bed: a 2-minute routine with tonight's plan</div></div><span class="tg"><input v-model="bed" type="checkbox" /></span></label>
        <label class="tgl"><div class="grow"><div class="t">Reality checks</div><div class="s">A few times a day: "Are you dreaming?"</div></div><span class="tg"><input v-model="rcOn" type="checkbox" /></span></label>
        <div v-if="rcOn" class="li"><div class="grow"><div class="t">How many a day</div><div class="s">5 to 10 is usual</div></div><NumStep :value="perDay" :min="PER_DAY_MIN" :max="PER_DAY_MAX" label="Reality checks a day" @set="(v) => (perDay = v)" /></div>
        <p class="tiny su-gap">{{ limits }} More in Settings · Reminders.</p>
      </template>

      <template v-else-if="at === 'safety'">
        <h1>Before you start</h1>
        <p class="muted su-lede"><LearnInline :nodes="parseInline(SAFETY_LEDE)" @cite="cite = $event" /></p>
        <label v-for="x in SAFETY_ITEMS" :key="x.id" class="tgl"><div class="grow"><div class="t">{{ x.label }}</div><div class="s">{{ x.hint }}</div></div><span class="tg"><input v-model="safe" type="checkbox" :value="x.id" /></span></label>
        <p v-if="safe.length" class="tiny su-gap"><LearnInline :nodes="parseInline(safetyNote)" @cite="cite = $event" /></p>
        <p class="tiny su-gap">Your answers stay on this device. Only "sleep first" goes with your account, so your other devices follow it without knowing why. Change them any time in Settings · Sleep.</p>
      </template>

      <template v-else-if="at === 'technique'">
        <h1>Tonight</h1>
        <p class="muted su-lede">A technique for tonight, added to tonight's plan in Train.</p>
        <ChoiceTiles v-model="technique" :options="TECHS" :cols="1" label="Technique" />
        <p class="tiny su-gap"><LearnInline :nodes="parseInline(techniqueNote)" @cite="cite = $event" /></p>
      </template>

      <template v-else-if="at === 'extras'">
        <h1>Extras</h1>
        <p class="muted su-lede">Off unless you want them. The rest are in Settings · Features.</p>
        <ChoiceTiles v-model="extras" :options="EXTRAS" multiple :cols="1" label="Extras" />
      </template>

      <template v-else>
        <h1>You're set</h1>
        <p class="muted su-lede">Tomorrow morning, before anything else, open Journal and write what you remember - a scrap is enough. Home shows what to do each day.</p>
        <button type="button" class="btn block lg" @click="finish('/')">Open Home</button>
        <p class="center tiny su-link"><a class="acc click" href="#" role="button" @click.prevent="finish('/journal')">Go to Journal</a></p>
        <p class="center tiny su-gap">Dates and times: {{ formats }} · <a class="acc click" href="#" role="button" @click.prevent="finish('/settings/formats')">Change</a></p>
      </template>

      <template v-if="at !== 'done'">
        <button type="button" class="btn block lg su-gap" :disabled="busy" @click="next">{{ busy ? "Saving..." : "Next" }}</button>
        <p class="center tiny su-link">
          <a v-if="setupOnly" class="acc click" href="#" role="button" @click.prevent="close">Not now</a>
          <template v-else>
            <a v-if="step > 0" class="acc click" href="#" role="button" @click.prevent="back">Back</a><template v-if="step > 0"> · </template>
            <a class="acc click" href="#" role="button" @click.prevent="skip">Skip</a> ·
            <a class="acc click" href="#" role="button" @click.prevent="skipAll">Skip setup</a>
          </template>
        </p>
      </template>
    </div>
    <SourceSheet v-if="cite" :ids="cite" @close="cite = null" />
  </div>
</template>

<style scoped>
.su-count { margin: var(--hg) 0 0; }
.su-lede { margin-bottom: var(--cpy); font-size: var(--fs-sm); }
.su-gap { margin-top: var(--cpy); }
.su-link { margin-top: var(--cpy); }
</style>
