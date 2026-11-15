// The reminders rows as Settings → Reminders and Settings → Reality checks both use them (PLAN.md §9, LDJ-28, LDJ-30):
// one row per kind, made on first use (native/reminders.ts writes them through the outbox). The first time a reminder
// is switched on, the browser or Android is asked for notifications; never earlier.
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { DEFAULT_RC_SCHEDULE, nightRow, rcSchedule, type NightKind, type NightSchedules, type RealityCheckSchedule } from "@somnium/shared";
import { invalidate } from "../../api/live";
import { toastError, savedToast } from "../../core/toast";
import { REMINDERS_KEY, fetchReminders, rcRow, putRcReminder, putNightReminder } from "../../native/reminders";
import { askNotificationPermission, notificationState, type NotificationState } from "../../native/notifications";

export const desktopApp = () => !!(globalThis as any).somniumNative?.reminders;

export function useReminders() {
  const rows = useQuery({ queryKey: [...REMINDERS_KEY], queryFn: fetchReminders, staleTime: 30_000 });
  const rc = computed(() => rcSchedule(rcRow(rows.data.value)?.schedule ?? DEFAULT_RC_SCHEDULE));
  const rcOn = computed(() => !!rcRow(rows.data.value)?.enabled);
  // the desktop app shows its own notifications, so it never needs asking
  const perm = ref<NotificationState>("prompt");
  const readPerm = async () => { perm.value = desktopApp() ? "granted" : await notificationState(); };
  const ask = async () => { if (!desktopApp()) { await askNotificationPermission(); await readPerm(); } };

  async function saveRc(patch: Partial<RealityCheckSchedule>, enabled = rcOn.value) {
    if (enabled && !rcOn.value) await ask();
    try { await putRcReminder(rows.data.value, { ...rc.value, ...patch }, enabled); savedToast(); } catch (e) { toastError(e); }
    invalidate(["reminders"]);
  }
  const night = <K extends NightKind>(k: K) => nightRow(rows.data.value, k);
  async function saveNight<K extends NightKind>(kind: K, patch: Partial<NightSchedules[K]> = {}, enabled?: boolean) {
    const cur = night(kind), on = enabled ?? cur.on;
    if (on && !cur.on) await ask();
    try { await putNightReminder(rows.data.value, kind, { ...cur.s, ...patch }, on); savedToast(); } catch (e) { toastError(e); }
    invalidate(["reminders"]);
  }
  return { rows, rc, rcOn, saveRc, night, saveNight, perm, readPerm, ask };
}
