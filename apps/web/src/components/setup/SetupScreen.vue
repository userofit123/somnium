<script setup lang="ts">
// The first-run setup (LDJ-77): a few short steps after the account is made, so day one has a plan instead of an empty,
// unexplained app. Each step is skippable, with Back, and one primary button. Every answer goes through the normal
// write paths (settings, the reminders rows, the course and tonight's night: outbox and live topics), so it syncs
// and every screen updates; nothing here is sealed. Shown by App.vue only behind an open lock (useSetup.ts).
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { DEFAULT_RC_SCHEDULE, PER_DAY_MAX, PER_DAY_MIN, nightRow, rcSchedule, type CourseLesson, type CourseProgress, type SetupExperience } from "@somnium/shared";
import { useSettings, saveSettings } from "../../api/queries";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { setLesson, planTonight } from "../../api/train";
import { REMINDERS_KEY, fetchReminders, rcRow, putRcReminder, putNightReminder, androidReminders } from "../../native/reminders";
import { askNotificationPermission } from "../../native/notifications";
import { toastError } from "../../core/toast";
import { setupRun, setupStep as step } from "./useSetup";
import Logo from "../../shell/Logo.vue";
import ChoiceTiles from "../ChoiceTiles.vue";
import TimePicker from "../TimePicker.vue";
import NumStep from "../NumStep.vue";

const router = useRouter();
const settings = useSettings();
const rows = useQuery({ queryKey: [...REMINDERS_KEY], queryFn: fetchReminders, staleTime: 30_000 });
const course = useQuery({ queryKey: ["course"], queryFn: () => api.get<CourseProgress[]>("/course") });
// once it shows it stays until the person leaves it, even after "done" is saved on the last step
onMounted(() => { setupRun.value = true; });

// The steps in order. The safety check (its own task, "A safety check in setup and before WBTB") goes in as one more
// id here, before "technique", with its block in the template; nothing else needs to change.
const STEPS = ["experience", "sleep", "reminders", "technique", "extras"] as const;
type StepId = (typeof STEPS)[number] | "done";
const at = computed<StepId>(() => STEPS[step.value] ?? "done");
const busy = ref(false);

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

// 2. usual sleep times
const bedtime = ref(settings.value.sleep.bedtime), wake = ref(settings.value.sleep.wake);

// 3. reminders: on by default here, so the first morning has its prompt (NIGHT_DEFAULT_ON keeps them off elsewhere)
const rc = computed(() => rcSchedule(rcRow(rows.data.value)?.schedule ?? DEFAULT_RC_SCHEDULE));
const rcOn = ref(true), perDay = ref(DEFAULT_RC_SCHEDULE.perDay), morning = ref(true), bed = ref(true);
const desktopApp = !!(globalThis as any).somniumNative?.reminders;
const limits = desktopApp ? "They come while Somnium is running, in the tray too."
  : androidReminders() ? "Android shows them on time, also with the app closed."
  : "A browser shows them only while Somnium is open in a tab or as an installed app; on a phone, the Android app is reliable.";

// 4. tonight's technique
const technique = ref("mild");
const TECHS = [
  { value: "mild", label: "MILD", hint: "Suggested: rehearse becoming lucid as you fall asleep" },
  { value: "ssild", label: "SSILD", hint: "Cycle through sight, sound and touch" },
  { value: "", label: "Nothing yet", hint: "Just the journal tomorrow morning" },
];

// 5. extras: the optional features most people want, switched on here instead of in Settings → Features
const EXTRAS = [
  { value: "goals", label: "Goals", hint: "A lucid dream a week, a full journal month" },
  { value: "dayNotes", label: "Day notes", hint: "A line about your day, to spot it in dreams later" },
  { value: "photos", label: "Photos", hint: "Add photos, read a paper journal page" },
  { value: "homeLesson", label: "Next lesson on Home", hint: "The lesson you are on, on Home" },
];
const extras = ref<string[]>(EXTRAS.map((e) => e.value).filter((k) => settings.value.features[k]));

/** Saves the step's answers, then moves on. Skip moves on without saving. */
async function next() {
  busy.value = true;
  try {
    if (at.value === "experience") {
      void saveSettings({ setup: { experience: experience.value } }, { quiet: true });
      if (!onCourse.value && experience.value) await setLesson(LESSON[experience.value], "active");
    } else if (at.value === "sleep") {
      void saveSettings({ sleep: { bedtime: bedtime.value, wake: wake.value } }, { quiet: true });
    } else if (at.value === "reminders") {
      // the browser and Android ask only now, when a reminder is switched on
      if ((rcOn.value || morning.value || bed.value) && !desktopApp) await askNotificationPermission();
      const rs = rows.data.value;
      await putRcReminder(rs, { ...rc.value, perDay: perDay.value }, rcOn.value);
      await putNightReminder(rs, "morning_journal", {}, morning.value);
      await putNightReminder(rs, "bedtime", nightRow(rs, "bedtime").s, bed.value);
      invalidate(["reminders"]);
    } else if (at.value === "technique") {
      if (technique.value) {
        await planTonight(technique.value, true);
        // the bedtime reminder names tonight's technique; its row was made on the step before
        const rs = await fetchReminders().catch(() => undefined), b = nightRow(rs, "bedtime");
        if (rs?.some((r) => r.kind === "bedtime" && !r.deletedAt) && b.on && b.s.technique !== technique.value) {
          await putNightReminder(rs, "bedtime", { ...b.s, technique: technique.value }, true);
          invalidate(["reminders"]);
        }
      }
    } else if (at.value === "extras") {
      void saveSettings({ features: Object.fromEntries(EXTRAS.map((e) => [e.value, extras.value.includes(e.value)])) }, { quiet: true });
    }
  } catch (e) { toastError(e); return; } finally { busy.value = false; }
  skip();
}
function skip() {
  step.value++;
  if (at.value === "done") void saveSettings({ setup: { done: true } }, { quiet: true });
}
function skipAll() { step.value = STEPS.length; void saveSettings({ setup: { done: true } }, { quiet: true }); }
function back() { if (step.value > 0) step.value--; }
function finish(to: string) { setupRun.value = false; step.value = 0; void router.push(to); }
</script>

<template>
  <div class="auth" role="main">
    <div class="card su">
      <Logo />
      <p v-if="at !== 'done'" class="tiny su-count">Step {{ step + 1 }} of {{ STEPS.length }}</p>

      <template v-if="at === 'experience'">
        <h1>Welcome to Somnium</h1>
        <p class="muted su-lede">A minute to set up your first night. How much lucid dreaming have you done?</p>
        <ChoiceTiles v-model="experience" :options="EXPERIENCES" :cols="1" label="Experience" />
        <p v-if="onCourse" class="tiny su-gap">You are on the course already; your lesson stays as it is.</p>
      </template>

      <template v-else-if="at === 'sleep'">
        <h1>Your sleep</h1>
        <p class="muted su-lede">Reminders, tonight's plan and the WBTB alarm follow these. Change them any time in Settings · Sleep.</p>
        <div class="frow">
          <div class="fld"><label>I usually go to bed at</label><TimePicker v-model="bedtime" title="Bedtime" /></div>
          <div class="fld"><label>I usually wake at</label><TimePicker v-model="wake" title="Wake time" /></div>
        </div>
      </template>

      <template v-else-if="at === 'reminders'">
        <h1>Reminders</h1>
        <p class="muted su-lede">Nothing from your journal is ever in them.</p>
        <label class="tgl"><div class="grow"><div class="t">Morning journal</div><div class="s">At your wake time: "Write your dream"</div></div><span class="tg"><input v-model="morning" type="checkbox" /></span></label>
        <label class="tgl"><div class="grow"><div class="t">Bedtime</div><div class="s">15 min before bed, with tonight's technique</div></div><span class="tg"><input v-model="bed" type="checkbox" /></span></label>
        <label class="tgl"><div class="grow"><div class="t">Reality checks</div><div class="s">A few times a day: "Are you dreaming?"</div></div><span class="tg"><input v-model="rcOn" type="checkbox" /></span></label>
        <div v-if="rcOn" class="li"><div class="grow"><div class="t">How many a day</div><div class="s">5 to 10 is usual</div></div><NumStep :value="perDay" :min="PER_DAY_MIN" :max="PER_DAY_MAX" label="Reality checks a day" @set="(v) => (perDay = v)" /></div>
        <p class="tiny su-gap">{{ limits }} More in Settings · Notifications.</p>
      </template>

      <template v-else-if="at === 'technique'">
        <h1>Tonight</h1>
        <p class="muted su-lede">A technique for tonight, added to tonight's plan in Train.</p>
        <ChoiceTiles v-model="technique" :options="TECHS" :cols="1" label="Technique" />
        <p class="tiny su-gap">MILD did best in the largest home study: a lucid dream on about one night in six in its practice week, SSILD close behind (Aspy 2020; RESEARCH.md Part B, 3.3, [38]).</p>
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
      </template>

      <template v-if="at !== 'done'">
        <button type="button" class="btn block lg su-gap" :disabled="busy" @click="next">{{ busy ? "Saving..." : "Next" }}</button>
        <p class="center tiny su-link">
          <a v-if="step > 0" class="acc click" href="#" role="button" @click.prevent="back">Back</a><template v-if="step > 0"> · </template>
          <a class="acc click" href="#" role="button" @click.prevent="skip">Skip</a> ·
          <a class="acc click" href="#" role="button" @click.prevent="skipAll">Skip setup</a>
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.su-count { margin: var(--hg) 0 0; }
.su-lede { margin-bottom: var(--cpy); font-size: var(--fs-sm); }
.su-gap { margin-top: var(--cpy); }
.su-link { margin-top: var(--cpy); }
</style>
