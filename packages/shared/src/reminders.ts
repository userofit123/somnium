// Reality check reminders (PLAN.md §9): the day's plan, worked out the same way on every device. Pure: the web app,
// the desktop app's main process and the Android app (LDJ-29) all call planDay and get the same times for a date,
// because the randomness comes from a seed stored in the synced reminders row, never from Math.random.
//
// Times are wall-clock "HH:MM" in the device's own time zone. Instants are made with the local Date constructor, which
// knows the zone's DST rules, and the spreading and the minimum gap are measured in real elapsed time, so a DST day is
// just a day that is an hour shorter or longer.
import type { CheckKind } from "./types";
import { TECHNIQUES } from "./journal";

/** A fixed reminder at a time the person picked, tied to something they do then. Labels come from a fixed list: a
 *  free-text label would be personal and would have to be sealed (packages/engine/src/sealed.ts), and the label is
 *  shown in a notification, which can appear on a locked screen. */
export const HABIT_LABELS = ["Walking through a door", "After a meal", "Washing your hands", "Checking your phone", "Getting up from a chair", "Arriving somewhere"] as const;
export type HabitLabel = (typeof HABIT_LABELS)[number];
export interface HabitMoment { at: string; label: HabitLabel }

/** What the reminders row (kind "reality_check") holds in its schedule JSON. Nothing in it is personal. */
export interface RealityCheckSchedule {
  perDay: number; // 1-20
  useSleep: boolean; // window from the Sleep settings: wake + 1 h to bedtime - 1 h
  from: string; // own waking window, used when useSleep is off
  to: string;
  quiet: { on: boolean; from: string; to: string };
  minGap: number; // minutes, at least 5
  habits: HabitMoment[];
  checks: string[]; // ids from packages/knowledge/lexicons/checks.json, rotated in turn
  showSign: boolean; // the top dream sign's name in the text: it is sealed, so off unless the person turns it on
  pausedOn: string | null; // "YYYY-MM-DD": no reminders that day
  seed: number; // fixed when the row is made; the same seed and date give the same plan everywhere
}

export const PER_DAY_MIN = 1, PER_DAY_MAX = 20;
export const DEFAULT_RC_SCHEDULE: RealityCheckSchedule = {
  perDay: 8, useSleep: true, from: "08:00", to: "22:00", quiet: { on: false, from: "12:30", to: "13:30" }, minGap: 30,
  habits: [], checks: ["nose-pinch", "re-read-text"], showSign: false, pausedOn: null, seed: 1,
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const time = (v: unknown, d: string) => (typeof v === "string" && HHMM.test(v) ? v : d);
const clampInt = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

/** A stored schedule with every value checked and missing ones defaulted: rows synced from an older or newer app still plan. */
export function rcSchedule(saved: unknown): RealityCheckSchedule {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, any>, D = DEFAULT_RC_SCHEDULE;
  const q = s.quiet && typeof s.quiet === "object" ? s.quiet : {};
  return {
    perDay: clampInt(s.perDay, PER_DAY_MIN, PER_DAY_MAX, D.perDay),
    useSleep: typeof s.useSleep === "boolean" ? s.useSleep : D.useSleep,
    from: time(s.from, D.from), to: time(s.to, D.to),
    quiet: { on: q.on === true, from: time(q.from, D.quiet.from), to: time(q.to, D.quiet.to) },
    minGap: clampInt(s.minGap, 5, 240, D.minGap),
    habits: Array.isArray(s.habits) ? s.habits.filter((h: any) => h && HHMM.test(h.at) && HABIT_LABELS.includes(h.label)).slice(0, 20).map((h: any) => ({ at: h.at, label: h.label })) : [],
    checks: Array.isArray(s.checks) && s.checks.some((c: unknown) => typeof c === "string") ? s.checks.filter((c: unknown): c is string => typeof c === "string").slice(0, 20) : D.checks,
    showSign: s.showSign === true,
    pausedOn: typeof s.pausedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.pausedOn) ? s.pausedOn : null,
    seed: clampInt(s.seed, 0, 2 ** 31 - 1, D.seed),
  };
}

const mins = (hhmm: string) => { const m = HHMM.exec(hhmm)!; return +m[1]! * 60 + +m[2]!; };
const fmt = (m: number) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };

/** The waking window: the person's own, or wake + 1 h to bedtime - 1 h from the Sleep settings. */
export function wakingWindow(s: RealityCheckSchedule, sleep?: { wake?: string; bedtime?: string }): { from: string; to: string } {
  if (!s.useSleep) return { from: s.from, to: s.to };
  return { from: fmt(mins(time(sleep?.wake, "07:00")) + 60), to: fmt(mins(time(sleep?.bedtime, "23:00")) - 60) };
}

/** The instant of a wall-clock time `dayOffset` days after `date`, in the device's zone. A time skipped by a DST jump
 *  comes out an hour later, as the Date constructor does it. */
function at(date: string, dayOffset: number, m: number): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, mo - 1, d + dayOffset, Math.floor(m / 60), m % 60, 0, 0).getTime();
}
const wallMins = (t: number) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const inRange = (m: number, from: number, to: number) => (from <= to ? m >= from && m < to : m >= from || m < to);

// a small seeded generator (mulberry32) and a string hash, so a seed and a date always give the same numbers
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };

export interface PlannedCheck { at: number; check: string; habit?: HabitLabel }

/**
 * The reality check reminders for the waking day that starts on `date` ("YYYY-MM-DD"): perDay times spread at random
 * over the waking window (which may run past midnight into the next date), none in quiet hours, none closer than
 * minGap to another, plus the habit moments at their own times (also kept out of quiet hours). Sorted by time.
 * Paused for the day: nothing. When the window can't hold perDay times that far apart, as many as fit.
 */
export function planDay(s: RealityCheckSchedule, date: string, seed = s.seed, sleep?: { wake?: string; bedtime?: string }): PlannedCheck[] {
  if (s.pausedOn === date) return [];
  const w = wakingWindow(s, sleep), fromM = mins(w.from), toM = mins(w.to);
  const start = at(date, 0, fromM), end = at(date, toM <= fromM ? 1 : 0, toM);
  const gap = s.minGap * 60_000;
  const quiet = (t: number) => s.quiet.on && inRange(wallMins(t), mins(s.quiet.from), mins(s.quiet.to));
  const rand = rng(hash(`${seed}:${date}`));
  const checks = s.checks.length ? s.checks : DEFAULT_RC_SCHEDULE.checks;
  const offset = Math.floor(rand() * checks.length);

  // habit moments: on the window's date, or the next one when the window crosses midnight and the time is after it
  const habits: PlannedCheck[] = [];
  for (const h of s.habits) {
    const m = mins(h.at), t = at(date, toM <= fromM && m < fromM ? 1 : 0, m);
    if (!quiet(t) && !habits.some((x) => x.at === t)) habits.push({ at: t, check: "", habit: h.label });
  }

  // random times: every free minute of the window in real time (not quiet, at least minGap from a habit moment), then
  // n of them at least minGap steps apart in that list - which is at least minGap minutes apart on the clock. Drawn
  // the "random gaps" way: n sorted draws from the slack left after the gaps, plus i gaps each, so any spread is
  // as likely as any other and a full window still fits all n.
  const free: number[] = [];
  for (let t = start; t <= end; t += 60_000) if (!quiet(t) && habits.every((h) => Math.abs(h.at - t) >= gap)) free.push(t);
  const g = s.minGap;
  const n = free.length ? Math.min(s.perDay, Math.floor((free.length - 1) / g) + 1) : 0;
  const slack = free.length - 1 - (n - 1) * g;
  const draws = Array.from({ length: n }, () => Math.floor(rand() * (slack + 1))).sort((x, y) => x - y);
  const picked = draws.map((d, i) => free[d + i * g]!);

  const all = [...picked.map((t) => ({ at: t, check: "" } as PlannedCheck)), ...habits].sort((a, b) => a.at - b.at);
  all.forEach((p, i) => { p.check = checks[(i + offset) % checks.length]!; });
  return all;
}

/** checks.json ids to the kinds the reality_checks table keeps. */
const KIND_OF: Record<string, CheckKind> = {
  "nose-pinch": "nose", "re-read-text": "text", "digital-clock": "clock", "light-switch": "light", "jumping": "jump",
  "finger-through-palm": "finger_palm", "counting-fingers": "hands",
};
export const checkKindOf = (checkId: string): CheckKind => KIND_OF[checkId] ?? "other";

/**
 * A reminder's words. Never dream text, never anything sealed - except the top dream sign's name, and only when the
 * person turned that on (showSign) and the device could read it.
 */
export function reminderText(check: { name: string; howTo: string }, o: { sign?: string | null; habit?: string | null } = {}): { title: string; body: string } {
  const lead = o.habit ? `${o.habit}: are you dreaming?` : "Are you dreaming?";
  const sign = o.sign ? ` Watch for ${o.sign}.` : "";
  return { title: `${lead} Really check.`, body: `${check.name}: ${check.howTo}${sign}` };
}

// ---------- night reminders (PLAN.md §9, LDJ-30): bedtime, the WBTB alarm, the morning journal, practice ----------
// Each is its own reminders row (kind bedtime / wbtb / morning_journal / practice), so each syncs and switches on its
// own. Their times come from the Sleep settings, not from the row: change bedtime once and every reminder follows.
// Nothing personal in any of them: the technique is an id from a fixed list, never the intention (which is sealed).

export type NightKind = "bedtime" | "wbtb" | "morning_journal" | "practice";
export const NIGHT_KINDS: readonly NightKind[] = ["bedtime", "wbtb", "morning_journal", "practice"];
export interface NightSchedules {
  bedtime: { lead: number; technique: string }; // minutes before bedtime (5-60); a TECHNIQUES id
  wbtb: Record<string, never>; // the time is the one planned for the night (Train → WBTB), never a standing alarm
  morning_journal: Record<string, never>; // at wake time
  practice: { at: string };
}
/** Switched on or off when the row doesn't exist yet: only the WBTB alarm, which rings only on a night it was planned. */
export const NIGHT_DEFAULT_ON: Record<NightKind, boolean> = { bedtime: false, wbtb: true, morning_journal: false, practice: false };
const NIGHT_DEFAULTS: NightSchedules = { bedtime: { lead: 15, technique: "mild" }, wbtb: {}, morning_journal: {}, practice: { at: "19:00" } };

/** A row's stored schedule, checked and defaulted like rcSchedule. */
export function nightSchedule<K extends NightKind>(kind: K, saved: unknown): NightSchedules[K] {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<string, any>;
  if (kind === "bedtime") return { lead: clampInt(s.lead, 5, 60, 15), technique: TECHNIQUES.some((t) => t.id === s.technique) ? s.technique : "mild" } as NightSchedules[K];
  if (kind === "practice") return { at: time(s.at, NIGHT_DEFAULTS.practice.at) } as NightSchedules[K];
  return {} as NightSchedules[K];
}

/** The rows as the planner needs them (a Reminder, or anything shaped like one). */
export interface ReminderRowLike { kind: string; enabled: boolean; schedule: unknown; deletedAt?: string | null }
/** Whether a night reminder is on, and its schedule: the live row of that kind, or the defaults. */
export function nightRow<K extends NightKind>(rows: readonly ReminderRowLike[] | undefined, kind: K): { on: boolean; s: NightSchedules[K] } {
  const r = rows?.find((x) => x.kind === kind && !x.deletedAt);
  return { on: r ? !!r.enabled : NIGHT_DEFAULT_ON[kind], s: nightSchedule(kind, r?.schedule) };
}

const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * The night that starts on the evening of `evening` ("YYYY-MM-DD"), from the usual sleep times: bedtime on that date,
 * or after midnight (the next date) when bedtime is before noon; wake at the first wake time after bedtime. `morning`
 * is the date the night is filed under (the morning's, as Home and the journal file it).
 */
export function nightTimes(evening: string, sleep?: { bedtime?: string; wake?: string }): { bedtime: number; wake: number; morning: string } {
  const b = mins(time(sleep?.bedtime, "23:00")), w = mins(time(sleep?.wake, "07:00"));
  const bedtime = at(evening, b < 12 * 60 ? 1 : 0, b);
  const bedDate = ymd(bedtime);
  let wake = at(bedDate, 0, w);
  if (wake <= bedtime) wake = at(bedDate, 1, w);
  return { bedtime, wake, morning: ymd(wake) };
}

export interface PlannedNightReminder { kind: NightKind; at: number; /** the date the night is filed under */ morning: string; technique?: string }

/**
 * The night reminders for the evening of `evening`, sorted: bedtime - lead (in real minutes, so across midnight and DST
 * alike), the WBTB alarm only when one is planned for this night (`wbtbAt`, an instant between noon of `evening` and
 * noon the next day), the morning journal at wake time, and practice at its own time on `evening`. Off rows give nothing.
 */
export function planNight(rows: readonly ReminderRowLike[] | undefined, evening: string, sleep?: { bedtime?: string; wake?: string }, wbtbAt?: number | null): PlannedNightReminder[] {
  const t = nightTimes(evening, sleep), out: PlannedNightReminder[] = [];
  const bed = nightRow(rows, "bedtime"), wb = nightRow(rows, "wbtb"), mo = nightRow(rows, "morning_journal"), pr = nightRow(rows, "practice");
  if (bed.on) out.push({ kind: "bedtime", at: t.bedtime - bed.s.lead * 60_000, morning: t.morning, technique: bed.s.technique });
  if (wb.on && typeof wbtbAt === "number" && wbtbAt >= at(evening, 0, 12 * 60) && wbtbAt < at(evening, 1, 12 * 60)) out.push({ kind: "wbtb", at: wbtbAt, morning: t.morning });
  if (mo.on) out.push({ kind: "morning_journal", at: t.wake, morning: t.morning });
  if (pr.on) out.push({ kind: "practice", at: at(evening, 0, mins(pr.s.at)), morning: t.morning });
  return out.sort((a, b) => a.at - b.at);
}

/** A night reminder's words, and the only line a locked screen shows (`lockTitle`). Never the intention or any dream. */
export function nightText(p: Pick<PlannedNightReminder, "kind" | "technique">, lead = 15): { title: string; body: string; lockTitle: string } {
  switch (p.kind) {
    case "bedtime": return { title: `Bed in ${lead} minutes`, body: `Tonight: ${TECHNIQUES.find((x) => x.id === p.technique)?.label ?? "MILD"}`, lockTitle: "Bedtime" };
    case "wbtb": return { title: "Time for WBTB", body: "Get up for a while, then back to bed. Tap for the guide.", lockTitle: "Alarm" };
    case "morning_journal": return { title: "Write your dream", body: "Even a fragment counts. Nothing came back? Say no recall.", lockTitle: "Morning" };
    case "practice": return { title: "Practice", body: "A few minutes on today's lesson.", lockTitle: "Practice" };
  }
}

/** Where tapping a night reminder goes. The morning's "No recall" opens the journal too: marking it means finding the
 *  night, a journal read, which needs the key (packages/engine/src/sync/sealedApi.ts allows only the unsealed check). */
export function nightUrl(p: Pick<PlannedNightReminder, "kind" | "morning">, action?: "norecall"): string {
  if (p.kind === "wbtb") return "/train?guided=up";
  if (p.kind === "morning_journal") return action === "norecall" ? `/journal?norecall=${p.morning}` : `/journal?write=1&date=${p.morning}`;
  return "/train";
}

/** A reality check logged from a notification's button (Android), waiting in the plugin's queue. account and user say
 *  whose reminder it was: the app account it was planned for, and who was signed in on it. */
export interface QueuedCheck { id: string; at: number; check: string; outcome: "awake" | "unsure" | "dreaming"; account?: string; user?: string }
/**
 * Which queued checks the open account may post now (mine), and which belong to another account on this device and
 * wait for it (others). One queued without an owner (made by an older version) can't be placed, so it is never
 * posted: it goes with the rest of what is acknowledged (stale). Nothing is posted while who is signed in is unknown.
 */
export function splitQueuedChecks<T extends QueuedCheck>(items: readonly T[], account: string | null | undefined, user: string | null | undefined): { mine: T[]; others: T[]; stale: T[] } {
  const out = { mine: [] as T[], others: [] as T[], stale: [] as T[] };
  for (const it of items) {
    if (!it.account || !it.user) out.stale.push(it);
    else if (account && user && it.account === account && it.user === user) out.mine.push(it);
    else out.others.push(it);
  }
  return out;
}
/** The queued checks of an account being removed from this device (with or without who was signed in on it). */
export const queuedChecksOf = <T extends QueuedCheck>(items: readonly T[], account: string): T[] => items.filter((it) => it.account === account);

/** The reality checks' ids (packages/knowledge/lexicons/checks.json; reminders-queue.test.ts keeps the two the same). */
export const CHECK_IDS = ["re-read-text", "digital-clock", "memory-test", "light-switch", "turning-180", "nose-pinch", "finger-through-palm", "counting-fingers", "jumping", "mirror"] as const;
/**
 * A reminders row's schedule as the server stores it. The reminders table is plain (not in SEALED_COLUMNS: it holds
 * times and choices from fixed lists, PLAN.md §9), so only those go in: the known keys, each with a time, a number, a
 * yes/no or a value from its fixed list (habit labels, check ids, techniques). Anything else, free text included, is
 * dropped, whatever sent it. Keys left out stay out (the readers default them).
 */
export function storableSchedule(saved: Record<string, unknown>): Record<string, unknown> {
  const s = saved as Record<string, any>, out: Record<string, unknown> = {};
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  for (const k of ["perDay", "minGap", "seed", "lead"]) if (num(s[k])) out[k] = s[k];
  for (const k of ["useSleep", "showSign"]) if (typeof s[k] === "boolean") out[k] = s[k];
  for (const k of ["from", "to", "at"]) if (typeof s[k] === "string" && HHMM.test(s[k])) out[k] = s[k];
  if (s.quiet && typeof s.quiet === "object") {
    const q: Record<string, unknown> = {};
    if (typeof s.quiet.on === "boolean") q.on = s.quiet.on;
    for (const k of ["from", "to"]) if (typeof s.quiet[k] === "string" && HHMM.test(s.quiet[k])) q[k] = s.quiet[k];
    out.quiet = q;
  }
  if (Array.isArray(s.habits)) out.habits = s.habits.filter((h: any) => h && typeof h.at === "string" && HHMM.test(h.at) && HABIT_LABELS.includes(h.label)).slice(0, 20).map((h: any) => ({ at: h.at, label: h.label }));
  if (Array.isArray(s.checks)) out.checks = s.checks.filter((c: unknown) => (CHECK_IDS as readonly unknown[]).includes(c)).slice(0, 20);
  if (s.pausedOn === null || (typeof s.pausedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.pausedOn))) out.pausedOn = s.pausedOn;
  if (TECHNIQUES.some((t) => t.id === s.technique)) out.technique = s.technique;
  return out;
}
