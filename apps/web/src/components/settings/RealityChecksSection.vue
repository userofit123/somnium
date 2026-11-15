<script setup lang="ts">
// Settings → Reality checks (PLAN.md §9, LDJ-28): the reality check reminder's switch and every option it has, in one
// place (LDJ-102). The waking window follows the usual sleep times, which are edited only in Settings → Sleep schedule
// (LDJ-103); here they are shown, with a way there. Nothing here is personal: habit labels come from a fixed list, and
// the dream signs' names stay out of reminders unless switched on. Guided checks (LDJ-112, on by default): a tap opens
// the 15-second check; off, the reminder logs with one tap as before.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { HABIT_LABELS, HABIT_WHY, habitSuggestions, PER_DAY_MAX, PER_DAY_MIN, planDay, wakingWindow } from "@somnium/shared";
import { useSettings } from "../../api/queries";
import { useFmt } from "../../core/format";
import { checkCatalog, localDate, androidReminders } from "../../native/reminders";
import { useReminders, desktopApp } from "./useReminders";
import AppSelect from "../AppSelect.vue";
import NumStep from "../NumStep.vue";
import TimePicker from "../TimePicker.vue";
import Icon from "../Icon.vue";
import Sheet from "../Sheet.vue";

const fmt = useFmt();
const router = useRouter();
const settings = useSettings();
const { rc: s, rcOn: on, saveRc: save } = useReminders();
const catalog = await checkCatalog();
const androidApp = !!androidReminders(), desktop = desktopApp();

const today = () => localDate(new Date());
const paused = computed(() => s.value.pausedOn === today());
const win = computed(() => wakingWindow(s.value, settings.value.sleep));
const toggleCheck = (id: string) => {
  const has = s.value.checks.includes(id);
  const next = has ? s.value.checks.filter((c) => c !== id) : [...s.value.checks, id];
  if (next.length) void save({ checks: next });
};
// Add opens a small sheet of suggestions, each with a sensible time; the time and label stay editable on the row
const adding = ref(false);
const suggestions = computed(() => habitSuggestions(settings.value.sleep.wake));
const addHabit = (h: { at: string; label: (typeof HABIT_LABELS)[number] }) => { adding.value = false; return save({ habits: [...s.value.habits, h] }); };
const setHabit = (i: number, patch: Record<string, unknown>) => save({ habits: s.value.habits.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
const dropHabit = (i: number) => save({ habits: s.value.habits.filter((_, j) => j !== i) });

// what's left of today's plan (and the first of tomorrow's), for a line under the switch
const nextAt = computed(() => {
  const now = Date.now(), d = new Date();
  for (const k of [-1, 0, 1]) {
    const date = localDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, 12));
    const p = planDay(s.value, date, s.value.seed, settings.value.sleep).find((x) => x.at > now);
    if (p) return p.at;
  }
  return null;
});
const todayCount = computed(() => planDay(s.value, today(), s.value.seed, settings.value.sleep).length);
const hm = (t: string) => fmt.value.time(`2000-01-01T${t}:00`);
</script>

<template>
  <div class="card">
    <label class="tgl"><div class="grow"><div class="t">Reality check reminders</div><div class="s">A few times a day: are you dreaming right now? Each one is paired with one of your top 3 dream signs in turn.</div></div><span class="tg"><input type="checkbox" :checked="on" @change="save({}, ($event.target as HTMLInputElement).checked)" /></span></label>
    <div v-if="on" class="li"><div class="grow"><div class="t">{{ paused ? "Paused for today" : nextAt ? `Next at ${fmt.time(new Date(nextAt).toISOString())}${localDate(new Date(nextAt)) !== today() ? " tomorrow" : ""}` : "None planned" }}</div><div class="s">{{ todayCount }} today · {{ win.from }} to {{ win.to }}</div></div>
      <button class="btn o s" @click="save({ pausedOn: paused ? null : today() })">{{ paused ? "Resume" : "Pause today" }}</button></div>
  </div>
  <p class="tiny m0">Reality checks work best together with MILD and a dream journal; checking on its own showed little benefit in studies (Aspy 2017 and 2020; RESEARCH.md Part B, 3.3 and 3.12, [37] [38]).</p>

  <template v-if="on">
    <div class="sh"><h2>When</h2></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">How many a day</div><div class="s">5 to 10 is usual (LaBerge, Tholey; RESEARCH.md Part C, 7, [1] [3] [4])</div></div><NumStep :value="s.perDay" :min="PER_DAY_MIN" :max="PER_DAY_MAX" @set="(v) => save({ perDay: v })" /></div>
      <div class="li"><div class="grow"><div class="t">Minimum gap</div><div class="s">Minutes between two reminders</div></div><NumStep :value="s.minGap" :step="5" :min="5" :max="240" unit="min" @set="(v) => save({ minGap: v })" /></div>
      <label class="tgl"><div class="grow"><div class="t">Use my sleep times</div><div class="s">From an hour after waking to an hour before bed</div></div><span class="tg"><input type="checkbox" :checked="s.useSleep" @change="save({ useSleep: ($event.target as HTMLInputElement).checked })" /></span></label>
      <!-- the sleep times are edited only in Sleep schedule, so a reminder never moves because of a change made here -->
      <div v-if="s.useSleep" class="li"><div class="grow"><div class="s">Uses your sleep times, {{ hm(settings.sleep.wake) }} to {{ hm(settings.sleep.bedtime) }}</div></div><button class="btn o s" type="button" @click="router.push('/settings/sleep')">Change</button></div>
      <div v-else class="frow">
        <div class="fld"><label>From</label><TimePicker :model-value="s.from" title="From" @update:model-value="(v) => save({ from: v })" /></div>
        <div class="fld"><label>To</label><TimePicker :model-value="s.to" title="To" @update:model-value="(v) => save({ to: v })" /></div>
      </div>
      <label class="tgl"><div class="grow"><div class="t">Quiet hours</div><div class="s">No reminders in this time</div></div><span class="tg"><input type="checkbox" :checked="s.quiet.on" @change="save({ quiet: { ...s.quiet, on: ($event.target as HTMLInputElement).checked } })" /></span></label>
      <div v-if="s.quiet.on" class="frow">
        <div class="fld"><label>Quiet from</label><TimePicker :model-value="s.quiet.from" title="Quiet from" @update:model-value="(v) => save({ quiet: { ...s.quiet, from: v } })" /></div>
        <div class="fld"><label>Quiet to</label><TimePicker :model-value="s.quiet.to" title="Quiet to" @update:model-value="(v) => save({ quiet: { ...s.quiet, to: v } })" /></div>
      </div>
    </div>

    <div class="sh"><h2>Habit moments</h2></div>
    <div class="card">
      <p class="tiny m0">A fixed reminder for something you do anyway, on top of the random ones. {{ HABIT_WHY }} (RESEARCH.md Part C, 7, [1])</p>
      <div v-for="(h, i) in s.habits" :key="i" class="frow ai-end">
        <div class="fld"><label>At</label><TimePicker :model-value="h.at" title="Habit time" @update:model-value="(v) => setHabit(i, { at: v })" /></div>
        <div class="fld grow"><label>When</label><AppSelect :model-value="h.label" :options="[...HABIT_LABELS]" title="Habit" @update:model-value="(v) => setHabit(i, { label: v })" /></div>
        <button class="btn o s" type="button" :aria-label="`Remove ${h.label}`" @click="dropHabit(i)"><Icon name="close" :size="15" /></button>
      </div>
      <div><button class="btn o s" type="button" @click="adding = true">Add a habit moment</button></div>
    </div>

    <div class="sh"><h2>Checks</h2></div>
    <div class="card">
      <p class="tiny m0">The reminders take these in turn.</p>
      <div class="chips"><button v-for="c in catalog" :key="c.id" type="button" class="fchip" :class="{ on: s.checks.includes(c.id) }" :aria-pressed="s.checks.includes(c.id)" @click="toggleCheck(c.id)">{{ c.name }}</button></div>
      <label class="tgl"><div class="grow"><div class="t">{{ androidApp ? "Vibrate only" : "No sound" }}</div><div class="s">{{ androidApp ? "Reality checks buzz with no sound, for places where sound is not wanted (RESEARCH.md Part C, 7, [39o] [39p])." : desktop ? "Reality checks come with no sound. This computer can't vibrate." : "Reality checks come with no sound. Browsers can't buzz on their own, so vibrating is only in the Android app." }}</div></div><span class="tg"><input type="checkbox" :checked="s.silent" @change="save({ silent: ($event.target as HTMLInputElement).checked })" /></span></label>
      <label class="tgl"><div class="grow"><div class="t">Guided checks</div><div class="s">A tap opens a 15-second check: the test, what just happened, and "if this were a dream?" Off: log it with one tap.</div></div><span class="tg"><input type="checkbox" :checked="s.guided" @change="save({ guided: ($event.target as HTMLInputElement).checked })" /></span></label>
      <label class="tgl"><div class="grow"><div class="t">Show my dream signs in reminders</div><div class="s">Names the dream sign each reminder is paired with, and its triggers. Off by default: they can be read on a locked screen.</div></div><span class="tg"><input type="checkbox" :checked="s.showSign" @change="save({ showSign: ($event.target as HTMLInputElement).checked })" /></span></label>
    </div>
  </template>

  <Sheet v-if="adding" title="Add a habit moment" @close="adding = false">
    <p>{{ HABIT_WHY }}</p>
    <div class="card flush"><button v-for="x in suggestions" :key="x.label" type="button" class="li click" @click="addHabit(x)"><div class="grow"><div class="t">{{ x.label }}</div><div class="s">Reminds you at {{ hm(x.at) }}; change the time after</div></div><Icon name="plus" :size="16" class="muted" /></button></div>
  </Sheet>
</template>
