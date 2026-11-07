<script setup lang="ts">
// Settings → Notifications: reality check reminders (PLAN.md §9, LDJ-28) and the night reminders (LDJ-30: bedtime,
// the WBTB alarm, the morning journal, practice; one reminders row each, made on first use, times from the Sleep
// settings). Everything here is the reminders row (kind
// "reality_check", its schedule JSON, enabled), which syncs; the usual sleep times are in the settings document. The
// plan is packages/shared/src/reminders.ts; native/reminders.ts delivers it. Nothing here is personal: habit labels
// come from a fixed list, and the dream sign's name stays out of reminders unless switched on.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { DEFAULT_RC_SCHEDULE, HABIT_LABELS, PER_DAY_MAX, PER_DAY_MIN, TECHNIQUES, nightRow, nightTimes, planDay, rcSchedule, reminderText, wakingWindow, type NightKind, type NightSchedules, type RealityCheckSchedule, type Reminder } from "@somnium/shared";
import { useSettings, saveSettings } from "../../api/queries";
import { api } from "../../api/client";
import { send } from "../../api/outbox";
import { invalidate, queryClient } from "../../api/live";
import { toastError, savedToast } from "../../core/toast";
import { useFmt } from "../../core/format";
import { isPhone } from "../../core/device";
import { REMINDERS_KEY, fetchReminders, rcRow, checkCatalog, localDate, showReminder, androidReminders, wbtbAlarm } from "../../native/reminders";
import { askNotificationPermission, notificationState, type NotificationState } from "../../native/notifications";
import AppSelect from "../AppSelect.vue";
import NumStep from "../NumStep.vue";
import TimePicker from "../TimePicker.vue";
import Icon from "../Icon.vue";

const fmt = useFmt();
const settings = useSettings();
const rows = useQuery({ queryKey: [...REMINDERS_KEY], queryFn: fetchReminders, staleTime: 30_000 });
const row = computed(() => rcRow(rows.data.value));
const s = computed(() => rcSchedule(row.value?.schedule ?? DEFAULT_RC_SCHEDULE));
const on = computed(() => !!row.value?.enabled);
const catalog = await checkCatalog();

const desktopApp = !!(globalThis as any).somniumNative?.reminders;
// the desktop app's own settings for this computer (apps/desktop/src/main.ts): closing to the tray keeps the reminders
// coming (LDJ-56; unset, it is on while reminders are planned), and starting at login starts it in the tray
interface DesktopSettings { closeToTray: boolean; trayAvailable: boolean; openAtLogin: boolean }
const desk = (globalThis as any).somniumNative?.desktop as { settings(): Promise<DesktopSettings>; setCloseToTray(on: boolean): Promise<boolean>; setOpenAtLogin(on: boolean): Promise<boolean> } | undefined;
const deskSet = ref<DesktopSettings | null>(null);
onMounted(async () => { deskSet.value = (await desk?.settings().catch(() => null)) ?? null; });
async function setTray(on: boolean) { try { const v = await desk!.setCloseToTray(on); if (deskSet.value) deskSet.value.closeToTray = v; savedToast(); } catch (e) { toastError(e); } }
async function setLogin(on: boolean) { try { const v = await desk!.setOpenAtLogin(on); if (deskSet.value) deskSet.value.openAtLogin = v; savedToast(); } catch (e) { toastError(e); } }
const androidApp = !!androidReminders();
// Android 12+: exact alarms can be switched off for an app; then reminders still come, a few minutes late at worst
const exact = ref<{ allowed: boolean; needsAsking: boolean } | null>(null);
const readExact = async () => { exact.value = androidApp ? await androidReminders()!.exactAlarms().catch(() => null) : null; };
async function allowExact() { await androidReminders()?.openExactAlarmSettings().catch(() => {}); }
// back from Android's settings page: read it again
const onVis = () => { if (document.visibilityState === "visible") { void readExact(); void notificationState().then((p) => { if (!desktopApp) perm.value = p; }); } };
onMounted(() => { void readExact(); document.addEventListener("visibilitychange", onVis); });
onUnmounted(() => document.removeEventListener("visibilitychange", onVis));
const phoneBrowser = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || isPhone.value;
const installed = matchMedia?.("(display-mode: standalone)").matches;
const perm = ref<NotificationState>("prompt");
const hasWorker = "serviceWorker" in navigator;
onMounted(async () => { perm.value = desktopApp ? "granted" : await notificationState(); });

// one row per person: made on first use with its own seed, so every device plans the same times
async function save(patch: Partial<RealityCheckSchedule>, enabled = on.value) {
  const schedule = { ...s.value, ...patch };
  try {
    if (row.value) {
      queryClient.setQueryData([...REMINDERS_KEY], (rs: Reminder[] | undefined) => rs?.map((r) => (r.id === row.value!.id ? { ...r, schedule, enabled } : r)));
      await send("put", `/reminders/${row.value.id}`, { schedule, enabled });
    } else {
      await send("post", "/reminders", { kind: "reality_check", enabled, schedule: { ...schedule, seed: Math.floor(Math.random() * 2 ** 31) } });
    }
    savedToast();
  } catch (e) { toastError(e); }
  invalidate(["reminders"]);
}

async function setOn(v: boolean) {
  // the browser is asked only now, when the person turns reminders on
  if (v && !desktopApp) { await askNotificationPermission(); perm.value = await notificationState(); }
  await save({}, v);
}

const today = () => localDate(new Date());
const paused = computed(() => s.value.pausedOn === today());
const win = computed(() => wakingWindow(s.value, settings.value.sleep));
const toggleCheck = (id: string) => {
  const has = s.value.checks.includes(id);
  const next = has ? s.value.checks.filter((c) => c !== id) : [...s.value.checks, id];
  if (next.length) void save({ checks: next });
};
const addHabit = () => save({ habits: [...s.value.habits, { at: "12:30", label: HABIT_LABELS[1] }] });
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
// ----- night reminders -----
const night = <K extends NightKind>(k: K) => nightRow(rows.data.value, k);
async function saveNight<K extends NightKind>(kind: K, patch: Partial<NightSchedules[K]> = {}, enabled?: boolean) {
  const r = rows.data.value?.find((x) => x.kind === kind && !x.deletedAt), cur = night(kind);
  const schedule = { ...cur.s, ...patch }, on = enabled ?? cur.on;
  if (on && !cur.on && !desktopApp) { await askNotificationPermission(); perm.value = await notificationState(); }
  try {
    if (r) {
      queryClient.setQueryData([...REMINDERS_KEY], (rs: Reminder[] | undefined) => rs?.map((x) => (x.id === r.id ? { ...x, schedule, enabled: on } : x)));
      await send("put", `/reminders/${r.id}`, { schedule, enabled: on });
    } else await send("post", "/reminders", { kind, enabled: on, schedule });
    savedToast();
  } catch (e) { toastError(e); }
  invalidate(["reminders"]);
}
const clock = (t: number) => fmt.value.time(new Date(t).toISOString());
const times = computed(() => nightTimes(today(), settings.value.sleep));
const techniques = TECHNIQUES.filter((t) => ["mild", "ssild", "wild", "wbtb", "vild", "fild", "deild", "reality-testing", "dream-signs", "incubation"].includes(t.id)).map((t) => ({ value: t.id, label: t.label }));
const wbtbSet = computed(() => { void rows.data.value; return wbtbAlarm(); });

async function tryNow() {
  const c = catalog.find((x) => x.id === s.value.checks[0]) ?? catalog[0]!;
  const ok = await showReminder({ ...reminderText(c), url: `/check?kind=${c.id}&prompted=1` });
  if (!ok) toastError(new Error("Notifications aren't allowed here"));
}
</script>

<template>
  <div class="card">
    <label class="tgl"><div class="grow"><div class="t">Reality check reminders</div><div class="s">A few times a day: "Are you dreaming? Really check." and how to do the check</div></div><span class="tg"><input type="checkbox" :checked="on" @change="setOn(($event.target as HTMLInputElement).checked)" /></span></label>
    <div v-if="on" class="li"><div class="grow"><div class="t">{{ paused ? "Paused for today" : nextAt ? `Next at ${fmt.time(new Date(nextAt).toISOString())}${localDate(new Date(nextAt)) !== today() ? " tomorrow" : ""}` : "None planned" }}</div><div class="s">{{ todayCount }} today · {{ win.from }} to {{ win.to }}</div></div>
      <button class="btn o s" @click="save({ pausedOn: paused ? null : today() })">{{ paused ? "Resume" : "Pause today" }}</button></div>
  </div>
  <p class="tiny" style="margin:0">Reality checks work best together with MILD and a dream journal; checking on its own showed little benefit in studies (Aspy 2017 and 2020; RESEARCH.md Part B, 3.3 and 3.12, [37] [38]).</p>

  <!-- what this device can do, said plainly -->
  <div class="card">
    <div class="li"><div class="grow"><div class="t">On this device</div>
      <div v-if="desktopApp" class="s">Reminders come while Somnium is running, minimised or behind other windows too.{{ deskSet?.trayAvailable && deskSet.closeToTray ? " Closing the window keeps it running in the tray, locked." : " Closing the window quits Somnium, and the reminders stop until it is opened again." }}</div>
      <div v-else-if="androidApp" class="s">Android shows them on time, also with the app closed, and again after the phone restarts. A reality check can be answered from the notification itself; the lock screen shows only "Reality check". Nothing from your journal is in them.</div>
      <div v-else class="s">A browser can't wake a closed page, so reminders come only while Somnium is open in a tab{{ installed ? " or this installed app" : " or as an installed app" }}, also in the background.<template v-if="phoneBrowser"> A phone stops pages in the background, so on a phone use the Android app for reliable reminders.</template><template v-else> On a phone the Android app is needed for reliable reminders.</template></div>
      <div v-if="androidApp" class="s">Exact alarms: {{ exact == null ? "unknown" : exact.allowed ? "allowed" : "off, so a reminder may come a few minutes late" }}</div>
      <div v-if="!desktopApp" class="s">Notifications: {{ perm === "granted" ? "allowed" : perm === "denied" ? "blocked; allow them in the browser's site settings" : perm === "unsupported" ? "not available in this browser" : "not asked yet" }}<template v-if="!hasWorker && perm !== 'unsupported'"> · no service worker here, so a tap may not open the app</template></div>
    </div><button v-if="androidApp && exact && !exact.allowed" class="btn o s" @click="allowExact">Allow exact alarms</button><button v-else-if="on && perm === 'granted'" class="btn o s" @click="tryNow">Try one</button></div>
    <template v-if="deskSet">
      <label v-if="deskSet.trayAvailable" class="tgl"><div class="grow"><div class="t">Keep running in the tray</div><div class="s">Closing the window hides it and locks Somnium; open or quit it from the tray icon</div></div><span class="tg"><input type="checkbox" :checked="deskSet.closeToTray" @change="setTray(($event.target as HTMLInputElement).checked)" /></span></label>
      <label class="tgl"><div class="grow"><div class="t">Start at login</div><div class="s">Starts in the tray, so reminders come from the moment you sign in</div></div><span class="tg"><input type="checkbox" :checked="deskSet.openAtLogin" @change="setLogin(($event.target as HTMLInputElement).checked)" /></span></label>
    </template>
  </div>

  <!-- the night: each its own row (reminders kind), times from the Sleep settings -->
  <div class="sh"><h2>Night and morning</h2></div>
  <div class="card">
    <label class="tgl"><div class="grow"><div class="t">Bedtime</div><div class="s">At {{ clock(times.bedtime - night("bedtime").s.lead * 60_000) }}, {{ night("bedtime").s.lead }} min before bed · "Tonight: {{ techniques.find((t) => t.value === night("bedtime").s.technique)?.label ?? "MILD" }}"</div></div><span class="tg"><input type="checkbox" :checked="night('bedtime').on" @change="saveNight('bedtime', {}, ($event.target as HTMLInputElement).checked)" /></span></label>
    <div v-if="night('bedtime').on" class="frow">
      <div class="fld grow"><label>Tonight's technique</label><AppSelect :model-value="night('bedtime').s.technique" :options="techniques" title="Technique" @update:model-value="(v) => saveNight('bedtime', { technique: v })" /></div>
      <div class="fld"><label>Minutes before bed</label><NumStep :value="night('bedtime').s.lead" :step="5" :min="5" :max="60" unit="min" @set="(v) => saveNight('bedtime', { lead: v })" /></div>
    </div>
    <label class="tgl"><div class="grow"><div class="t">WBTB alarm</div><div class="s">Only on nights you plan WBTB in Train<template v-if="wbtbSet"> · set for {{ clock(wbtbSet) }}</template><template v-if="androidApp"> · rings like an alarm</template></div></div><span class="tg"><input type="checkbox" :checked="night('wbtb').on" @change="saveNight('wbtb', {}, ($event.target as HTMLInputElement).checked)" /></span></label>
    <label class="tgl"><div class="grow"><div class="t">Morning journal</div><div class="s">At {{ clock(times.wake) }}, your wake time · "Write your dream", with No recall</div></div><span class="tg"><input type="checkbox" :checked="night('morning_journal').on" @change="saveNight('morning_journal', {}, ($event.target as HTMLInputElement).checked)" /></span></label>
    <label class="tgl"><div class="grow"><div class="t">Practice</div><div class="s">Once a day, for the course</div></div><span class="tg"><input type="checkbox" :checked="night('practice').on" @change="saveNight('practice', {}, ($event.target as HTMLInputElement).checked)" /></span></label>
    <div v-if="night('practice').on" class="frow"><div class="fld"><label>Practice at</label><TimePicker :model-value="night('practice').s.at" title="Practice" @update:model-value="(v) => saveNight('practice', { at: v })" /></div></div>
    <p class="tiny" style="margin:0">Times follow your sleep times ({{ clock(times.bedtime) }} to {{ clock(times.wake) }}). Nothing from your journal or your intention is shown.</p>
  </div>

  <template v-if="on">
    <div class="sh"><h2>When</h2></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">How many a day</div><div class="s">6 to 12 is usual</div></div><NumStep :value="s.perDay" :min="PER_DAY_MIN" :max="PER_DAY_MAX" @set="(v) => save({ perDay: v })" /></div>
      <div class="li"><div class="grow"><div class="t">Minimum gap</div><div class="s">Minutes between two reminders</div></div><NumStep :value="s.minGap" :step="5" :min="5" :max="240" unit="min" @set="(v) => save({ minGap: v })" /></div>
      <label class="tgl"><div class="grow"><div class="t">Use my sleep times</div><div class="s">From an hour after waking to an hour before bed</div></div><span class="tg"><input type="checkbox" :checked="s.useSleep" @change="save({ useSleep: ($event.target as HTMLInputElement).checked })" /></span></label>
      <div class="frow">
        <template v-if="s.useSleep">
          <div class="fld"><label>I usually wake at</label><TimePicker :model-value="settings.sleep.wake" title="Wake time" @update:model-value="(v) => saveSettings({ sleep: { wake: v } })" /></div>
          <div class="fld"><label>I usually go to bed at</label><TimePicker :model-value="settings.sleep.bedtime" title="Bedtime" @update:model-value="(v) => saveSettings({ sleep: { bedtime: v } })" /></div>
        </template>
        <template v-else>
          <div class="fld"><label>From</label><TimePicker :model-value="s.from" title="From" @update:model-value="(v) => save({ from: v })" /></div>
          <div class="fld"><label>To</label><TimePicker :model-value="s.to" title="To" @update:model-value="(v) => save({ to: v })" /></div>
        </template>
      </div>
      <label class="tgl"><div class="grow"><div class="t">Quiet hours</div><div class="s">No reminders in this time</div></div><span class="tg"><input type="checkbox" :checked="s.quiet.on" @change="save({ quiet: { ...s.quiet, on: ($event.target as HTMLInputElement).checked } })" /></span></label>
      <div v-if="s.quiet.on" class="frow">
        <div class="fld"><label>Quiet from</label><TimePicker :model-value="s.quiet.from" title="Quiet from" @update:model-value="(v) => save({ quiet: { ...s.quiet, from: v } })" /></div>
        <div class="fld"><label>Quiet to</label><TimePicker :model-value="s.quiet.to" title="Quiet to" @update:model-value="(v) => save({ quiet: { ...s.quiet, to: v } })" /></div>
      </div>
    </div>

    <div class="sh"><h2>Habit moments</h2></div>
    <div class="card">
      <p class="tiny" style="margin:0">Fixed times on top of the random ones, tied to something you do then.</p>
      <div v-for="(h, i) in s.habits" :key="i" class="frow" style="align-items:end">
        <div class="fld"><label>At</label><TimePicker :model-value="h.at" title="Habit time" @update:model-value="(v) => setHabit(i, { at: v })" /></div>
        <div class="fld grow"><label>When</label><AppSelect :model-value="h.label" :options="[...HABIT_LABELS]" title="Habit" @update:model-value="(v) => setHabit(i, { label: v })" /></div>
        <button class="btn o s" type="button" :aria-label="`Remove ${h.label}`" @click="dropHabit(i)"><Icon name="close" :size="15" /></button>
      </div>
      <div><button class="btn o s" type="button" @click="addHabit">Add a habit moment</button></div>
    </div>

    <div class="sh"><h2>Checks</h2></div>
    <div class="card">
      <p class="tiny" style="margin:0">The reminders take these in turn.</p>
      <div class="chips"><button v-for="c in catalog" :key="c.id" type="button" class="fchip" :class="{ on: s.checks.includes(c.id) }" :aria-pressed="s.checks.includes(c.id)" @click="toggleCheck(c.id)">{{ c.name }}</button></div>
      <label class="tgl"><div class="grow"><div class="t">Show my dream sign in reminders</div><div class="s">Adds your top dream sign's name. Off by default: it can be read on a locked screen.</div></div><span class="tg"><input type="checkbox" :checked="s.showSign" @change="save({ showSign: ($event.target as HTMLInputElement).checked })" /></span></label>
    </div>
  </template>
</template>
