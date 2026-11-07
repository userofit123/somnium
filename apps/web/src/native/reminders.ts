// Reality check reminders on this device (PLAN.md §9, LDJ-28). The plan itself is packages/shared/src/reminders.ts
// (the Android app, LDJ-29, uses the same one); this file delivers it.
// - Browser and installed web app: a timer in the open page shows each due reminder through the service worker
//   (registration.showNotification), so a tap reaches the worker's notificationclick and opens /check. Browsers have
//   no way to wake a closed page at a set time (Notification Triggers never shipped), so reminders only come while a
//   tab or the installed app is open, in the background included. Settings says so.
// - Desktop app: the plan goes to the main process (preload's somniumNative.reminders), whose own timers show native
//   notifications while the app runs, whatever the window is doing.
// - Android app (LDJ-29): the plan for the coming week goes to the SomniumReminders plugin (apps/android), which sets
//   exact alarms, shows each notification itself (Awake / Not sure / Dreaming! log a check without opening the app,
//   into a small queue posted from here on the next open, flushPending), and sets them again after a restart from the
//   last plan it was given. A week ahead, so a phone left alone for days still reminds; every open plans again.
// - Night reminders (LDJ-30): bedtime, the WBTB alarm, the morning journal and practice, one reminders row each, from
//   planNight (shared). The WBTB alarm's time is the one planned for the night on this device (setWbtbAlarm, LDJ-25),
//   opening /train?guided=up; on Android it is a real alarm with sound.
// Words: the question and the check's own instruction, nothing from the journal. The top dream sign's name (sealed)
// only when the person switched that on, and only while this device can read it.
import { QueryObserver } from "@tanstack/vue-query";
import { planDay, planNight, nightRow, nightText, nightUrl, rcSchedule, reminderText, queuedChecksOf, splitQueuedChecks, withDefaults, type QueuedCheck, type Reminder, type RealityCheckSchedule, type Settings } from "@somnium/shared";
import { api } from "../api/client";
import { send } from "../api/outbox";
import { queryClient } from "../api/live";
import { keyring } from "../core/keyring";
import { readStr, writeStr } from "../core/prefs";
import { isNativeApp } from "./notifications";
import { logCheck } from "../api/checks";
import { session } from "../core/session";
import { current as currentAccount } from "./accounts";

/** An action button: opens the app at `url`, or (Android) logs a check with `outcome` without opening it. */
export interface ReminderAction {
  id: string; title: string; url?: string; outcome?: "awake" | "unsure" | "dreaming"; check?: string;
  /** whose check it logs (the app account and the person signed in on it): the queue posts it to that one only */
  account?: string; user?: string;
}
export interface DueReminder {
  at: number; title: string; body: string; url: string; tag?: string;
  kind?: "reality_check" | "bedtime" | "wbtb" | "morning_journal" | "practice";
  /** All a locked screen shows of it (Android: the notification's public version). */
  lockTitle?: string;
  actions?: ReminderAction[];
}
interface DesktopReminders { setPlan(items: DueReminder[]): Promise<unknown>; onPause?(cb: (on: boolean) => void): void }
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

/** The reality check reminders due from `now` over the coming `days` waking days (1: until the end of tomorrow's). */
export async function upcoming(s: RealityCheckSchedule, settings: Settings, now = Date.now(), sign: string | null = null, days = 1): Promise<DueReminder[]> {
  const catalog = await checkCatalog();
  const today = new Date(now), out: DueReminder[] = [], owner = queueOwner();
  // yesterday too: its window may run past midnight into today
  for (let d = -1; d <= days; d++) {
    for (const p of planDay(s, localDate(addDays(today, d)), s.seed, settings.sleep)) {
      if (p.at < now - 60_000) continue;
      const c = catalog.find((x) => x.id === p.check) ?? catalog[0]!;
      const { title, body } = reminderText(c, { sign: s.showSign ? sign : null, habit: p.habit });
      out.push({
        at: p.at, title, body, url: `/check?kind=${encodeURIComponent(p.check)}&prompted=1`, kind: "reality_check", lockTitle: "Reality check",
        actions: CHECK_OUTCOMES.map(([outcome, t]) => ({ id: outcome, title: t, outcome, check: p.check, ...owner })),
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
const CHECK_OUTCOMES = [["awake", "Awake"], ["unsure", "Not sure"], ["dreaming", "Dreaming!"]] as const;

/** The night reminders (bedtime, WBTB, morning, practice) due from `now` over the coming `days` evenings. */
export function upcomingNights(rows: Reminder[] | undefined, settings: Settings, now = Date.now(), days = 1): DueReminder[] {
  const out: DueReminder[] = [], today = new Date(now), wbtb = wbtbAlarm(), lead = nightRow(rows, "bedtime").s.lead;
  for (let d = -1; d <= days; d++) {
    for (const p of planNight(rows, localDate(addDays(today, d)), settings.sleep, wbtb)) {
      if (p.at < now - 60_000) continue;
      const { title, body, lockTitle } = nightText(p, lead);
      const r: DueReminder = { at: p.at, title, body, lockTitle, url: nightUrl(p), kind: p.kind, tag: `somnium-${p.kind}` };
      if (p.kind === "wbtb") r.actions = [{ id: "up", title: "I'm up", url: nightUrl(p) }];
      if (p.kind === "morning_journal") r.actions = [{ id: "norecall", title: "No recall", url: nightUrl(p, "norecall") }];
      out.push(r);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Shows one reminder now: through the service worker when there is one (a tap opens its page, a button its own),
 *  else a plain one. */
export async function showReminder(r: Pick<DueReminder, "title" | "body" | "url" | "tag" | "actions">) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  // the browser's buttons only open pages (a check is logged on /check, which the tap opens anyway)
  const acts = (r.actions ?? []).filter((a) => a.url);
  const opts = {
    body: r.body, tag: r.tag ?? "somnium-reality-check", icon: "/icon-192.png", badge: "/icon-192.png", requireInteraction: false,
    data: { url: r.url, actions: Object.fromEntries(acts.map((a) => [a.id, a.url])) }, actions: acts.map((a) => ({ action: a.id, title: a.title })),
  } as NotificationOptions;
  const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (reg) { await reg.showNotification(r.title, opts); return true; }
  const n = new Notification(r.title, opts);
  n.onclick = () => { focus(); location.assign(r.url); };
  return true;
}

// ----- Android: the SomniumReminders plugin (apps/android) -----
interface AndroidReminders {
  schedule(o: { items: (DueReminder & { channel: string })[] }): Promise<{ count: number; exact: boolean }>;
  pending(): Promise<{ items: QueuedCheck[] }>;
  ack(o: { ids: string[] }): Promise<void>;
  exactAlarms(): Promise<{ allowed: boolean; needsAsking: boolean }>;
  openExactAlarmSettings(): Promise<void>;
}
export const androidReminders = (): AndroidReminders | undefined => (globalThis as any).Capacitor?.getPlatform?.() === "android" ? (globalThis as any).Capacitor?.Plugins?.SomniumReminders : undefined;
const ANDROID_DAYS = 7;
const channelOf = (r: DueReminder) => (r.kind === "wbtb" ? "wbtb_alarm" : r.kind === "reality_check" ? "reality_checks" : "night");

// Checks logged from a notification's buttons wait in the plugin's queue; they go through the same locked-safe path as
// /check (logCheck: no note, nothing sealed). Ids already sent are remembered here, so a queue that wasn't cleared
// (the app closed between the two steps) can't send one twice.
const SENT = "somniumQueuedChecksSent";
/** The account and person a check logged from a notification belongs to; nothing when either is unknown. */
const queueOwner = (): { account?: string; user?: string } => {
  const account = currentAccount()?.id, user = session.user?.id;
  return account && user ? { account, user } : {};
};
let flushing = false;
export async function flushPending() {
  const p = androidReminders();
  if (!p || flushing) return;
  flushing = true;
  try {
    const { items } = await p.pending();
    if (!items?.length) return;
    // only the open account's, for whoever is signed in on it; another account's wait for it (a check logged under
    // one account and posted to another would land in the wrong journal). One without an owner can't be placed: dropped.
    const { account, user } = queueOwner(), { mine, stale } = splitQueuedChecks(items, account, user);
    const sent = new Set<string>(JSON.parse(readStr(SENT, "[]")) as string[]), done: string[] = stale.map((it) => it.id);
    for (const it of mine) {
      if (!sent.has(it.id)) {
        try { await logCheck(it.check, it.outcome, true, { at: it.at }); } catch { break; } // tried again on the next open
        sent.add(it.id);
        writeStr(SENT, JSON.stringify([...sent].slice(-200)));
      }
      done.push(it.id);
    }
    if (done.length) await p.ack({ ids: done });
  } catch { /* the plugin is older than this page: nothing queued */ } finally { flushing = false; }
}

// ----- the running scheduler -----
const FIRED = "somniumRcFired"; // the last reminder shown, shared by every tab of this browser so only one shows it
let tick: ReturnType<typeof setInterval> | null = null, next: ReturnType<typeof setTimeout> | null = null;
let plan: DueReminder[] = [], stops: (() => void)[] = [], planDate = "";
let current: { rows: Reminder[] | undefined; settings: Settings } = { rows: undefined, settings: withDefaults({}) };

// ----- the WBTB alarm (LDJ-25): one time, kept on this device; nothing personal in its words -----
const WBTB = "somniumWbtbAlarm";
export const WBTB_URL = "/train?guided=up";
/** The WBTB alarm set on this device (ms), or null. */
export function wbtbAlarm(): number | null {
  const at = Number(readStr(WBTB, "0"));
  return at > Date.now() - 60_000 ? at : null;
}
/** Sets (or with null clears) the WBTB alarm here; the running scheduler (web, desktop or Android) picks it up at once. */
export async function setWbtbAlarm(at: number | null) {
  writeStr(WBTB, at ? String(at) : "0");
  if (tick) await replan();
}

async function replan() {
  const rows = current.rows, row = rcRow(rows), a = androidReminders();
  const days = a ? ANDROID_DAYS : 1;
  planDate = localDate(new Date());
  const nights = upcomingNights(rows, current.settings, Date.now(), days);
  if (!row || !row.enabled) plan = nights;
  else {
    const s = rcSchedule(row.schedule);
    plan = [...await upcoming(s, current.settings, Date.now(), s.showSign ? await topSign() : null, days), ...nights].sort((x, y) => x.at - y.at);
  }
  if (a) { await a.schedule({ items: plan.map((r) => ({ ...r, channel: channelOf(r) })) }).catch(() => {}); plan = []; }
  const d = desktop();
  if (d) { await d.setPlan(plan.map(({ actions, lockTitle, kind, ...r }) => r)).catch(() => {}); plan = []; }
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
    // the latest of each kind: a night reminder isn't lost behind a reality check due the same minute
    const latest = new Map<string, DueReminder>();
    for (const r of due) latest.set(r.kind ?? "reality_check", r);
    for (const r of latest.values()) if (now - r.at < 15 * 60_000) await showReminder(r).catch(() => {});
  }
  arm();
}

/** Starts the reminders for whoever is signed in (and their changes from any device); stopReminders ends them. */
export function startReminders() {
  stopReminders();
  // a native app other than Android's (none yet) has no way to deliver them
  if (isNativeApp() && !androidReminders()) return;
  const rowsQ = new QueryObserver(queryClient, { queryKey: [...REMINDERS_KEY], queryFn: fetchReminders, staleTime: 60_000 });
  const me = new QueryObserver(queryClient, { queryKey: ["settings", "me"], queryFn: () => api.get("/me"), staleTime: 60_000 });
  const update = () => {
    const r = rowsQ.getCurrentResult().data as Reminder[] | undefined, m = me.getCurrentResult().data as any;
    const rows = r?.filter((x) => !x.deletedAt);
    const settings = withDefaults(m?.settings ?? {});
    if (JSON.stringify([rows, settings.sleep]) === JSON.stringify([current.rows, current.settings.sleep])) return;
    current = { rows, settings };
    void replan();
  };
  // every start is locked, so the first plan has no dream sign; the key opening brings it in
  const onKey = (open: boolean) => { const row = rcRow(current.rows); if (open && row?.enabled && rcSchedule(row.schedule).showSign) void replan(); };
  stops = [rowsQ.subscribe(update), me.subscribe(update), keyring.onChange(onKey)];
  // the desktop tray's "Pause reminders today" / "Resume reminders": the same pausedOn as Settings' Pause today, so it
  // syncs and every device pauses (the reminders row carries nothing sealed, so this works while locked)
  desktop()?.onPause?.((on) => {
    const row = rcRow(current.rows);
    if (!row) return;
    const schedule = { ...rcSchedule(row.schedule), pausedOn: on ? localDate(new Date()) : null };
    queryClient.setQueryData([...REMINDERS_KEY], (rs: Reminder[] | undefined) => rs?.map((r) => (r.id === row.id ? { ...r, schedule } : r)));
    void send("put", `/reminders/${row.id}`, { schedule, enabled: row.enabled }).catch(() => {});
  });
  // Android: coming back to the app plans again (a new day, a changed clock) and sends checks logged from notifications
  const app = (globalThis as any).Capacitor?.Plugins?.App;
  if (androidReminders() && app?.addListener) {
    const h = app.addListener("resume", () => { void flushPending(); void replan(); });
    stops.push(() => void Promise.resolve(h).then((x: any) => x?.remove?.()));
    void flushPending();
  }
  update();
  tick = setInterval(() => { void fire(); if (androidReminders()) void flushPending(); }, 30_000);
  addEventListener("visibilitychange", onVisible);
}
const onVisible = () => { if (document.visibilityState === "visible") void fire(); };
export function stopReminders() {
  for (const s of stops) s(); stops = [];
  if (tick) clearInterval(tick); if (next) clearTimeout(next); tick = next = null;
  removeEventListener("visibilitychange", onVisible);
  plan = []; current = { rows: undefined, settings: withDefaults({}) };
  void desktop()?.setPlan([]).catch(() => {});
  void androidReminders()?.schedule({ items: [] }).catch(() => {});
}
/** The planned times still to come here (Settings shows the next one). */
export const plannedAhead = () => plan.slice();

/** An account removed from this phone: the checks its notifications queued go too (native/accounts.ts drop). */
export async function forgetQueuedChecks(account: string) {
  const p = androidReminders();
  if (!p) return;
  try {
    const { items } = await p.pending();
    const ids = queuedChecksOf(items ?? [], account).map((it) => it.id);
    if (ids.length) await p.ack({ ids });
  } catch { /* the plugin is older than this page: nothing queued with an owner */ }
}
