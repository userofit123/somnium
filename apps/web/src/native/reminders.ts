// Reality check reminders on this device (PLAN.md §9, LDJ-28). The plan itself is packages/shared/src/reminders.ts
// (the Android app, LDJ-29, uses the same one); this file delivers it.
// - Browser and installed web app: a timer in the open page shows each due reminder through the service worker
//   (registration.showNotification), so a tap reaches the worker's notificationclick and opens /check. Browsers have
//   no way to wake a closed page at a set time (Notification Triggers never shipped), so reminders only come while a
//   tab or the installed app is open, in the background included. Settings says so.
// - Desktop app: the plan goes to the main process (preload's somniumNative.reminders), whose own timers show native
//   notifications while the app runs, whatever the window is doing.
// - Android app: nothing here; LDJ-29 schedules exact alarms from the same plan.
// - The WBTB alarm (LDJ-25) rides the same plan: the planner stores its time on this device (setWbtbAlarm) and it is
//   shown like a reminder, opening /train?guided=up. The same limits apply, and the guided screen says so.
// Words: the question and the check's own instruction, nothing from the journal. The top dream sign's name (sealed)
// only when the person switched that on, and only while this device can read it.
import { QueryObserver } from "@tanstack/vue-query";
import { planDay, rcSchedule, reminderText, withDefaults, type Reminder, type RealityCheckSchedule, type Settings } from "@somnium/shared";
import { api } from "../api/client";
import { queryClient } from "../api/live";
import { keyring } from "../core/keyring";
import { readStr, writeStr } from "../core/prefs";
import { isNativeApp } from "./notifications";

export interface DueReminder { at: number; title: string; body: string; url: string; tag?: string }
interface DesktopReminders { setPlan(items: DueReminder[]): Promise<unknown> }
const desktop = (): DesktopReminders | undefined => (globalThis as any).somniumNative?.reminders;

export const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);

/** The reality check reminders row (one per person), as the screens and this file read it. */
export const REMINDERS_KEY = ["reminders", "list"] as const;
export const fetchReminders = () => api.get<Reminder[]>("/reminders");
export const rcRow = (rows: Reminder[] | undefined) => rows?.find((r) => r.kind === "reality_check" && !r.deletedAt) ?? null;

let checksCache: Awaited<typeof import("@somnium/knowledge/lexicons")>["checks"] | null = null;
export async function checkCatalog() {
  return (checksCache ??= (await import("@somnium/knowledge/lexicons")).checks);
}

/** The most-linked confirmed dream sign's own name, or null. Sealed, so it is read only while the key is open here:
 *  the transports refuse journal reads while locked as well (allowedWithoutKey), this just doesn't ask. A plan made
 *  while locked goes without it, and a new one is made when the key opens (startReminders). */
async function topSign(): Promise<string | null> {
  if (!keyring.isOpen()) return null;
  try {
    const [els, links] = await Promise.all([api.get<any[]>("/elements", { signs: 1 }), api.get<any[]>("/dream-elements")]);
    const n = new Map<string, number>();
    for (const l of links) if (!l.deletedAt) n.set(l.elementId, (n.get(l.elementId) ?? 0) + 1);
    const best = els.filter((e) => e.isDreamSign && typeof e.name === "string" && e.name).sort((a, b) => (+b.confirmed - +a.confirmed) || (n.get(b.id) ?? 0) - (n.get(a.id) ?? 0))[0];
    return best?.name ?? null;
  } catch { return null; }
}

/** The reminders due from `now` until the end of tomorrow's waking day, with their words. */
export async function upcoming(s: RealityCheckSchedule, settings: Settings, now = Date.now(), sign: string | null = null): Promise<DueReminder[]> {
  const catalog = await checkCatalog();
  const today = new Date(now), out: DueReminder[] = [];
  // yesterday too: its window may run past midnight into today
  for (const d of [-1, 0, 1]) {
    for (const p of planDay(s, localDate(addDays(today, d)), s.seed, settings.sleep)) {
      if (p.at < now - 60_000) continue;
      const c = catalog.find((x) => x.id === p.check) ?? catalog[0]!;
      const { title, body } = reminderText(c, { sign: s.showSign ? sign : null, habit: p.habit });
      out.push({ at: p.at, title, body, url: `/check?kind=${encodeURIComponent(p.check)}&prompted=1` });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Shows one reminder now: through the service worker when there is one (a tap opens /check), else a plain one. */
export async function showReminder(r: Pick<DueReminder, "title" | "body" | "url" | "tag">) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const opts: NotificationOptions = { body: r.body, tag: (r as DueReminder).tag ?? "somnium-reality-check", icon: "/icon-192.png", badge: "/icon-192.png", data: { url: r.url }, requireInteraction: false } as NotificationOptions;
  const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (reg) { await reg.showNotification(r.title, opts); return true; }
  const n = new Notification(r.title, opts);
  n.onclick = () => { focus(); location.assign(r.url); };
  return true;
}

// ----- the running scheduler -----
const FIRED = "somniumRcFired"; // the last reminder shown, shared by every tab of this browser so only one shows it
let tick: ReturnType<typeof setInterval> | null = null, next: ReturnType<typeof setTimeout> | null = null;
let plan: DueReminder[] = [], stops: (() => void)[] = [], planDate = "";
let current: { row: Reminder | null; settings: Settings } = { row: null, settings: withDefaults({}) };

// ----- the WBTB alarm (LDJ-25): one time, kept on this device; nothing personal in its words -----
const WBTB = "somniumWbtbAlarm";
export const WBTB_URL = "/train?guided=up";
/** The WBTB alarm set on this device (ms), or null. */
export function wbtbAlarm(): number | null {
  const at = Number(readStr(WBTB, "0"));
  return at > Date.now() - 60_000 ? at : null;
}
function wbtbItems(): DueReminder[] {
  const at = wbtbAlarm();
  return at ? [{ at, title: "Time for WBTB", body: "Get up for a while, then back to bed. Tap for the guide.", url: WBTB_URL, tag: "somnium-wbtb" }] : [];
}
/** Sets (or with null clears) the WBTB alarm here; the running scheduler (web or desktop) picks it up at once. */
export async function setWbtbAlarm(at: number | null) {
  writeStr(WBTB, at ? String(at) : "0");
  if (tick) await replan();
}

async function replan() {
  const row = current.row;
  planDate = localDate(new Date());
  if (!row || !row.enabled) plan = wbtbItems();
  else {
    const s = rcSchedule(row.schedule);
    plan = [...await upcoming(s, current.settings, Date.now(), s.showSign ? await topSign() : null), ...wbtbItems()].sort((a, b) => a.at - b.at);
  }
  const d = desktop();
  if (d) { await d.setPlan(plan).catch(() => {}); plan = []; }
  arm();
}

// a timer to the next one, plus a check every 30 s: a background tab's timers are slowed, and a computer that slept
// wakes up past its timers. Something missed by more than 15 minutes is skipped, not shown late.
function arm() {
  if (next) clearTimeout(next);
  const n = plan.find((p) => p.at > Number(readStr(FIRED, "0")));
  if (n) next = setTimeout(fire, Math.max(0, Math.min(n.at - Date.now(), 2 ** 31 - 1)));
}
async function fire() {
  if (localDate(new Date()) !== planDate) { await replan(); return; }
  const now = Date.now(), last = Number(readStr(FIRED, "0"));
  const due = plan.filter((p) => p.at <= now && p.at > last);
  if (due.length) {
    writeStr(FIRED, String(due[due.length - 1]!.at));
    const r = due[due.length - 1]!;
    if (now - r.at < 15 * 60_000) await showReminder(r).catch(() => {});
  }
  arm();
}

/** Starts the reminders for whoever is signed in (and their changes from any device); stopReminders ends them. */
export function startReminders() {
  stopReminders();
  if (isNativeApp()) return;
  const rows = new QueryObserver(queryClient, { queryKey: [...REMINDERS_KEY], queryFn: fetchReminders, staleTime: 60_000 });
  const me = new QueryObserver(queryClient, { queryKey: ["settings", "me"], queryFn: () => api.get("/me"), staleTime: 60_000 });
  const update = () => {
    const r = rows.getCurrentResult().data as Reminder[] | undefined, m = me.getCurrentResult().data as any;
    const row = rcRow(r);
    const settings = withDefaults(m?.settings ?? {});
    if (JSON.stringify([row, settings.sleep]) === JSON.stringify([current.row, current.settings.sleep])) return;
    current = { row, settings };
    void replan();
  };
  // every start is locked, so the first plan has no dream sign; the key opening brings it in
  const onKey = (open: boolean) => { if (open && current.row?.enabled && rcSchedule(current.row.schedule).showSign) void replan(); };
  stops = [rows.subscribe(update), me.subscribe(update), keyring.onChange(onKey)];
  update();
  tick = setInterval(() => void fire(), 30_000);
  addEventListener("visibilitychange", onVisible);
}
const onVisible = () => { if (document.visibilityState === "visible") void fire(); };
export function stopReminders() {
  for (const s of stops) s(); stops = [];
  if (tick) clearInterval(tick); if (next) clearTimeout(next); tick = next = null;
  removeEventListener("visibilitychange", onVisible);
  plan = []; current = { row: null, settings: withDefaults({}) };
  void desktop()?.setPlan([]).catch(() => {});
}
/** The planned times still to come here (Settings shows the next one). */
export const plannedAhead = () => plan.slice();
