// The WBTB planner's choices kept on this device (guided/WbtbPlanner.vue), shared with Tonight's "Use this plan"
// (TonightPlan.vue, LDJ-108), so a one-tap plan sets the same alarm the planner would have opened on, and asks for
// the same permission to show it.
import { cycleOf, isWbtbMode, wbtbModePlan, type WbtbMode } from "@somnium/shared";
import { readStr } from "../../core/prefs";

/** Tonight's own mode when one is planned, else the last one used in the planner, else Long (the tested 6 h timing [D13]). */
export function keptWbtbMode(nightMode?: string | null): WbtbMode {
  const m = nightMode ?? readStr("somniumWbtbMode", "long");
  return isWbtbMode(m) ? m : "long";
}
/** The cycle length the planner last used, when it differs from Settings > Sleep; else that setting. */
export const keptWbtbCycle = (settingsCycle: number) => cycleOf(Number(readStr("somniumWbtbCycle", "")) || settingsCycle);

/**
 * The alarm for a suggested "WBTB + MILD" night: the planner's mode and cycle length, except the nap mode, which is a
 * different plan (an hour up, then a 90-minute nap [D4]) and not WBTB with MILD back in bed, so it falls back to Long.
 */
export function wbtbForMild(bed: Date, settingsCycle: number): { mode: WbtbMode; at: Date } {
  const kept = keptWbtbMode();
  const mode: WbtbMode = kept === "nap" ? "long" : kept;
  return { mode, at: wbtbModePlan(bed, mode, { cycleMin: keptWbtbCycle(settingsCycle) }).alarm.at };
}

const desktop = () => !!(globalThis as { somniumNative?: { reminders?: unknown } }).somniumNative?.reminders;
/** The permission the alarm needs to show, asked for once while it is still undecided (the desktop app shows its own). */
export function alarmPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}
export async function askAlarmPermission(): Promise<NotificationPermission | "unsupported"> {
  const p = alarmPermission();
  if (desktop() || p !== "default") return p;
  return Notification.requestPermission().catch(() => "default" as NotificationPermission);
}
