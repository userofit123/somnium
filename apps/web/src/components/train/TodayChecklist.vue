<script setup lang="ts">
// "Today" (PLAN.md §6.1 and §6.3, LDJ-97): the one checklist of what to do today, the same on Home and on Train > Today.
// Journal and reality checks tick themselves from the day's own data (a row is written once, when the condition is
// first true; the checks row also links to the reminder settings, LDJ-119); the course practice items are ticked by hand; the top sign ticks when its page is opened; the evening
// review has its own short screen, opened from here after 18:00. All ticks are practice_log rows, so ticking here
// updates every screen. The lesson texts come from the page (they load with it, not with this component).
import { computed, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { CORE_HABITS, allDoneStreak, eveningOf, habitStreak, nextReminder, pmDay } from "@somnium/shared";
import { tickPractice } from "../../api/train";
import { toastError } from "../../core/toast";
import { useFmt } from "../../core/format";
import { useHabits } from "./useHabits";
import ProgressBar from "../ProgressBar.vue";

const props = defineProps<{ lesson: { id: string; title: string; items: { id: string; text: string }[] } | null; home?: boolean }>();
const h = useHabits(), router = useRouter(), fmt = useFmt();
const tickToday = (id: string, on = true) => tickPractice(id, h.today.value, on, h.rowOf(id)).catch(toastError);

// the clock moves on while the page is open (the next reminder, the evening review): a minute's tick is enough
const now = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 60_000);
onUnmounted(() => clearInterval(clock));

// automatic ticks: only ever on, once the lists are in. Home and Train can both be mounted, so the "already sent" flag
// per day and item is shared by every copy: it stops a second write while the first is in flight
watch([h.ready, h.wroteToday, h.checksToday, h.checkTarget, h.today], () => {
  if (!h.ready.value) return;
  const want: [string, boolean][] = [["habit:journal", h.wroteToday.value], ["habit:checks", h.checksToday.value >= h.checkTarget.value]];
  for (const [id, ok] of want) {
    const key = h.today.value + id;
    if (ok && !h.rowOf(id) && !sent.has(key)) { sent.add(key); void tickToday(id); }
  }
}, { immediate: true });

const habit = (id: string) => CORE_HABITS.find((c) => c.id === id)!;
const on = (id: string) => !!h.rowOf(id);
const streak = (id: string) => habitStreak(h.rows.value, id, h.today.value);
const days = (n: number) => (n === 1 ? "1 day" : `${n} days`);

const checks = computed(() => ({ done: h.checksToday.value, target: h.checkTarget.value, pct: Math.min(100, Math.round((h.checksToday.value / h.checkTarget.value) * 100)) }));
const next = computed(() => nextReminder(h.plan.value.times, now.value));
const practice = computed(() => (props.lesson?.items ?? []).map((i) => ({ ...i, on: on(i.id) })));
const busy = ref(false);
async function tick(id: string) {
  busy.value = true;
  try { await tickToday(id, !on(id)); } finally { busy.value = false; }
}
const pm = computed(() => {
  const d = pmDay(h.rows.value, h.today.value), hit = d.targets.filter((x) => x.state === "hit").length, open = d.targets.filter((x) => x.state === "open").length;
  return d.targets.length ? { done: !open, line: [`${hit} of ${d.targets.length} hit`, open ? `${open} still open` : ""].filter(Boolean).join(" · ") } : null;
});
const evening = computed(() => new Date(now.value).getHours() >= 18);
// after midnight the evening is still yesterday's: a review done at 22:00 stays ticked until the new day's 05:00 cutoff
const reviewed = computed(() => !!h.rowAt("habit:review", eveningOf(h.today.value, new Date(now.value).getHours())));
const sixPm = computed(() => { const d = new Date(h.today.value + "T18:00:00"); return fmt.value.time(d.toISOString()); });
const count = computed(() => {
  const all = [on("habit:journal"), on("habit:checks"), ...practice.value.map((p) => p.on), on("habit:sign"), reviewed.value];
  return `${all.filter(Boolean).length} of ${all.length}`;
});
const all = computed(() => allDoneStreak(h.rows.value, h.today.value));
// the auto-ticked boxes are only a picture (hidden from screen readers, never focused), so each row says its state in words
const said = (done: boolean) => (done ? "Done: " : "Not done: ");
</script>

<script lang="ts">
const sent = new Set<string>();
</script>

<template>
  <section class="tday">
    <div class="sh"><h2>Today</h2><span class="tiny">{{ count }}</span></div>
    <div class="card flush">
      <div class="li">
        <input type="checkbox" class="ro" :checked="on('habit:journal')" tabindex="-1" aria-hidden="true" @click.prevent />
        <div class="grow"><div class="t"><span class="sr">{{ said(on("habit:journal")) }}</span>{{ habit("habit:journal").name }}</div><div class="tiny">{{ on("habit:journal") ? "Done for today" : habit("habit:journal").auto }}</div></div>
        <span v-if="streak('habit:journal')" class="tiny tdstreak num">{{ days(streak("habit:journal")) }}</span>
      </div>

      <div class="li tdchecks">
        <div class="tdrow">
          <input type="checkbox" class="ro" :checked="on('habit:checks')" tabindex="-1" aria-hidden="true" @click.prevent />
          <div class="grow">
            <div class="t"><span class="sr">{{ said(on("habit:checks")) }}</span>Reality checks</div>
            <div class="tiny"><span class="num">{{ checks.done }} of {{ checks.target }}</span><template v-if="h.remindersOn.value && next"> · next reminder {{ fmt.time(new Date(next).toISOString()) }}</template><template v-else-if="!h.remindersOn.value"> · reminders off</template> · <router-link to="/settings/reality-checks" class="lnk inl">{{ h.remindersOn.value ? "Change" : "Set up reminders" }}</router-link></div>
          </div>
          <!-- one tap opens /check, which returns here when done -->
          <button type="button" class="btn o s" @click="router.push('/check')">Log a check</button>
        </div>
        <ProgressBar :percent="checks.pct" label="Reality checks done today" />
      </div>

      <label v-for="p in practice" :key="p.id" class="li tdtick">
        <input type="checkbox" :checked="p.on" :disabled="busy" @click.prevent="tick(p.id)" />
        <div class="grow"><div class="t">{{ p.text }}</div><div class="tiny">Practice · {{ lesson!.title }}</div></div>
      </label>

      <div class="li">
        <input type="checkbox" class="ro" :checked="on('habit:sign')" tabindex="-1" aria-hidden="true" @click.prevent />
        <router-link :to="h.topSign.value ? '/signs/' + h.topSign.value.id : '/signs'" class="grow tdl" @click="tickToday('habit:sign')">
          <div class="t"><span class="sr">{{ said(on("habit:sign")) }}</span>{{ habit("habit:sign").name }}</div><div class="tiny">{{ h.topSign.value?.name ?? habit("habit:sign").auto }}</div>
        </router-link>
        <span v-if="streak('habit:sign')" class="tiny tdstreak num">{{ days(streak("habit:sign")) }}</span>
      </div>

      <!-- memory targets live on Train, so only Home's copy links there -->
      <component :is="home ? 'router-link' : 'div'" v-if="pm" :to="home ? '/train' : undefined" class="li" :class="{ tdl: home }">
        <input type="checkbox" class="ro" :checked="pm.done" tabindex="-1" aria-hidden="true" @click.prevent />
        <div class="grow"><div class="t"><span class="sr">{{ said(pm.done) }}</span>Memory targets</div><div class="tiny">{{ pm.line }}</div></div>
      </component>

      <div class="li">
        <input type="checkbox" class="ro" :checked="reviewed" tabindex="-1" aria-hidden="true" @click.prevent />
        <router-link v-if="evening" to="/train/review" class="grow tdl"><div class="t"><span class="sr">{{ said(reviewed) }}</span>{{ habit("habit:review").name }}</div><div class="tiny">{{ habit("habit:review").auto }}</div></router-link>
        <div v-else class="grow"><div class="t"><span class="sr">{{ said(reviewed) }}</span>{{ habit("habit:review").name }}</div><div class="tiny">From {{ sixPm }}: tonight's intention and your top sign.</div></div>
        <span v-if="streak('habit:review')" class="tiny tdstreak num">{{ days(streak("habit:review")) }}</span>
      </div>
    </div>
    <p class="tiny tdall">Journal, checks, dream sign and evening review all done: <b class="num">{{ days(all) }}</b> in a row</p>
  </section>
</template>
