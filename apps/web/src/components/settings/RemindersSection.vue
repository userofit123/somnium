<script setup lang="ts">
// Settings → Reminders (PLAN.md §9; LDJ-28 reality checks, LDJ-30 the night ones): one card listing everything that
// can ping you, each with its switch and time (LDJ-102). The reality checks' many options live on their own screen
// (RealityChecksSection); the night ones have one or two each, shown under their row while on. Times come from the
// usual sleep times, edited only in Settings → Sleep schedule (LDJ-103). Below, one line says whether reminders will
// reach this device and offers the one step that fixes it (LDJ-105); the reasons are in the "?" sheet.
// Nothing here is personal: no journal text, no intention.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { COURSE_LESSONS, currentLesson, nightTimes, reminderText, wakingWindow } from "@somnium/shared";
import { useSettings } from "../../api/queries";
import { useCourse } from "../../api/train";
import { toastError, savedToast } from "../../core/toast";
import { useFmt } from "../../core/format";
import { isPhone } from "../../core/device";
import { checkCatalog, localDate, showReminder, androidReminders, wbtbAlarm } from "../../native/reminders";
import { reminderDelivery } from "../../native/notifications";
import { useReminders, desktopApp } from "./useReminders";
import NumStep from "../NumStep.vue";
import TimePicker from "../TimePicker.vue";
import Icon from "../Icon.vue";
import Sheet from "../Sheet.vue";

const fmt = useFmt();
const router = useRouter();
const settings = useSettings();
const { rows, rc, rcOn, saveRc, night, saveNight, perm, readPerm, ask } = useReminders();
const catalog = await checkCatalog();

const desktop = desktopApp();
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
// back from Android's or the browser's settings: read both again
const onVis = () => { if (document.visibilityState === "visible") { void readExact(); void readPerm(); } };
onMounted(() => { void readExact(); void readPerm(); document.addEventListener("visibilitychange", onVis); });
onUnmounted(() => document.removeEventListener("visibilitychange", onVis));
const phoneBrowser = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || isPhone.value;
const installed = matchMedia?.("(display-mode: standalone)").matches;
const hasWorker = "serviceWorker" in navigator;

// ----- will they arrive, and the one fix -----
const status = computed(() => reminderDelivery({ desktop, android: androidApp, perm: perm.value, exactAllowed: exact.value?.allowed ?? null, phone: phoneBrowser }));
const FIX_LABEL = { allow: "Allow notifications", exact: "Allow exact alarms", android: "Get the Android app", help: "How to fix", test: "Send a test" } as const;
const info = ref(false);
async function fix() {
  const f = status.value.fix;
  if (f === "allow") await ask();
  else if (f === "exact") await androidReminders()?.openExactAlarmSettings().catch(() => {});
  else if (f === "android") await router.push("/settings/about");
  else if (f === "help") info.value = true;
  else await sendTest();
}
async function sendTest() {
  const c = catalog.find((x) => x.id === rc.value.checks[0]) ?? catalog[0]!;
  const ok = await showReminder({ ...reminderText(c), url: `/check?kind=${c.id}&prompted=1` });
  if (!ok) toastError(new Error("Notifications aren't allowed here"));
}

// ----- the list -----
const today = () => localDate(new Date());
const clock = (t: number) => fmt.value.time(new Date(t).toISOString());
const hm = (t: string) => fmt.value.time(`2000-01-01T${t}:00`);
const times = computed(() => nightTimes(today(), settings.value.sleep));
const win = computed(() => wakingWindow(rc.value, settings.value.sleep));
const rcLine = computed(() => `${rc.value.perDay} a day · ${win.value.from} to ${win.value.to}${rc.value.pausedOn === today() ? " · paused today" : ""}`);
const wbtbSet = computed(() => { void rows.data.value; return wbtbAlarm(); });
// the practice reminder belongs to the course: shown once a lesson has been started (or while it is still on, so it can be
// switched off), otherwise a line says where to start (LDJ-172)
const course = useCourse();
const courseKnown = computed(() => course.data.value !== undefined);
const lessonNo = computed(() => { const l = currentLesson(course.data.value ?? []); return l ? COURSE_LESSONS.indexOf(l) + 1 : null; });
const started = computed(() => (course.data.value ?? []).some((c) => c.state === "active" || c.state === "done"));
const practiceShown = computed(() => night("practice").on || (started.value && lessonNo.value !== null));
const checked = (e: Event) => (e.target as HTMLInputElement).checked;
</script>

<template>
  <div class="card">
    <!-- reality checks: the row opens their own screen; the switch works here too -->
    <div class="li"><button type="button" class="grow rlink" @click="router.push('/settings/reality-checks')"><div class="grow"><div class="t">Reality checks</div><div class="s">{{ rcOn ? rcLine : "A few times a day while you're awake" }}</div></div><Icon name="right" :size="16" class="muted" /></button>
      <span class="tg"><input type="checkbox" :checked="rcOn" aria-label="Reality checks" @change="saveRc({}, checked($event))" /></span></div>

    <label class="tgl"><div class="grow"><div class="t">Bedtime</div><div class="s">{{ night("bedtime").on ? `${clock(times.bedtime - night("bedtime").s.lead * 60_000)}, ${night("bedtime").s.lead} min before bed · with what you plan in Train, Tonight` : "Before bed, with what you plan in Train, Tonight" }}</div></div><span class="tg"><input type="checkbox" :checked="night('bedtime').on" @change="saveNight('bedtime', {}, checked($event))" /></span></label>
    <div v-if="night('bedtime').on" class="frow">
      <div class="fld"><label>Minutes before bed</label><NumStep :value="night('bedtime').s.lead" :step="5" :min="5" :max="60" unit="min" @set="(v) => saveNight('bedtime', { lead: v })" /></div>
    </div>

    <label class="tgl"><div class="grow"><div class="t">Wake back to bed (WBTB) alarm</div><div class="s">Wakes you in the night for a short stretch awake, only on nights you plan it in Train<template v-if="wbtbSet"> · set for {{ clock(wbtbSet) }}</template><template v-if="androidApp"> · rings like an alarm</template> · <router-link to="/learn/techniques/wbtb" class="lnk inl" @click.stop>What is WBTB?</router-link></div></div><span class="tg"><input type="checkbox" :checked="night('wbtb').on" @change="saveNight('wbtb', {}, checked($event))" /></span></label>

    <label class="tgl"><div class="grow"><div class="t">Morning journal</div><div class="s">{{ clock(times.wake) }}, your wake time · "Write your dream", with No recall</div></div><span class="tg"><input type="checkbox" :checked="night('morning_journal').on" @change="saveNight('morning_journal', {}, checked($event))" /></span></label>

    <template v-if="practiceShown">
      <label class="tgl"><div class="grow"><div class="t">Daily lesson practice</div><div class="s">A nudge to do today's practice{{ lessonNo ? ` from lesson ${lessonNo}` : "" }}{{ night("practice").on ? ` · ${hm(night("practice").s.at)}` : "" }}</div></div><span class="tg"><input type="checkbox" :checked="night('practice').on" @change="saveNight('practice', {}, checked($event))" /></span></label>
      <div v-if="night('practice').on" class="frow"><div class="fld"><label>Practice at</label><TimePicker :model-value="night('practice').s.at" title="Practice" @update:model-value="(v) => saveNight('practice', { at: v })" /></div></div>
    </template>
    <div v-else-if="courseKnown" class="li"><div class="grow"><div class="s">Start the course in Train to get a daily practice reminder</div></div><button class="btn o s" type="button" @click="router.push('/train')">Open Train</button></div>

    <!-- the sleep times are edited only in Sleep schedule; here they are only shown -->
    <div class="li"><div class="grow"><div class="s">Uses your sleep times, {{ hm(settings.sleep.bedtime) }} to {{ hm(settings.sleep.wake) }}. Nothing from your journal or your intention is shown.</div></div><button class="btn o s" type="button" @click="router.push('/settings/sleep')">Change</button></div>
  </div>

  <!-- will they arrive here: one line, one fix, the reasons behind "?" -->
  <div class="card">
    <div class="li"><span class="dot" :class="status.tone" aria-hidden="true" /><div class="grow"><div class="t">{{ status.text }}</div></div>
      <button class="ib sm plain" type="button" aria-label="About reminders on this device" @click="info = true"><Icon name="info" :size="17" /></button>
      <button class="btn o s" type="button" @click="fix">{{ FIX_LABEL[status.fix] }}</button></div>
    <template v-if="deskSet">
      <label v-if="deskSet.trayAvailable" class="tgl"><div class="grow"><div class="t">Keep running in the tray</div><div class="s">Closing the window hides it and locks Somnium; open or quit it from the tray icon</div></div><span class="tg"><input type="checkbox" :checked="deskSet.closeToTray" @change="setTray(checked($event))" /></span></label>
      <label class="tgl"><div class="grow"><div class="t">Start at login</div><div class="s">Starts in the tray, so reminders come from the moment you sign in</div></div><span class="tg"><input type="checkbox" :checked="deskSet.openAtLogin" @change="setLogin(checked($event))" /></span></label>
    </template>
  </div>

  <Sheet v-if="info" title="Reminders on this device" @close="info = false">
    <p v-if="desktop">Reminders come while Somnium is running, minimised or behind other windows too.{{ deskSet?.trayAvailable && deskSet.closeToTray ? " Closing the window keeps it running in the tray, locked." : " Closing the window quits Somnium, and the reminders stop until it is opened again." }}</p>
    <template v-else-if="androidApp">
      <p>Android shows them on time, also with the app closed, and again after the phone restarts. A reality check can be answered from the notification itself; the lock screen shows only "Reality check".</p>
      <p>Exact alarms: {{ exact == null ? "unknown" : exact.allowed ? "allowed" : "off, so a reminder may come a few minutes late. Allow them in Android's settings for Somnium." }}</p>
    </template>
    <p v-else>A browser can't wake a closed page, so reminders come only while Somnium is open in a tab{{ installed ? " or this installed app" : " or as an installed app" }}, also in the background.{{ phoneBrowser ? " A phone stops pages in the background, so on a phone use the Android app for reliable reminders." : " On a phone the Android app is needed for reliable reminders." }}</p>
    <p v-if="!desktop">Notifications: {{ perm === "granted" ? "allowed" : perm === "denied" ? (androidApp ? "blocked. Allow them in Android's settings: Apps, Somnium, Notifications." : "blocked. Allow them in the browser's site settings for this address (the lock or info icon next to it), then come back.") : perm === "unsupported" ? "not available in this browser" : "not asked yet" }}<template v-if="!hasWorker && perm !== 'unsupported'"> No service worker here, so a tap may not open the app.</template></p>
    <p>Nothing from your journal is in a reminder.</p>
  </Sheet>
</template>

<style scoped>
/* the reality checks row: its words and arrow open the screen, the switch stays a switch */
.rlink { display: flex; align-items: center; gap: 12px; min-width: 0; border: 0; padding: 0; background: none; font: inherit; color: inherit; text-align: start; cursor: pointer; }
/* the state's colour: a round light, as a status lamp reads */
.dot { border-radius: 50%; }
.dot.ok { background: var(--pos); }
.dot.warn { background: var(--warn); }
.dot.bad { background: var(--neg); }
</style>
