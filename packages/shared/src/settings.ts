// A person's settings, with defaults. Stored as JSON per user; missing keys fall back to these.
// Nothing personal lives here (PLAN.md §4): these are preferences, and they sync in the clear.
import { FEATURE_DEFAULTS, RETIRED_FEATURES } from "./features";
import type { Dismissal } from "./recommend";
import type { Milestones } from "./milestones";

export interface Settings {
  /** "auto" (the default) follows the device's language: see deviceFormats. Older accounts keep what they chose. */
  firstDay: 0 | 1 | "auto";
  dateFormat: "dmy" | "mdy" | "ymd" | "auto";
  clock: "24" | "12" | "auto";
  features: Record<string, boolean>;
  notifications: { updates: boolean };
  backup: { on: boolean; every: "daily" | "weekly"; at: string; keep: number; /** encrypt: the old password-encrypted backups, no longer read; passphrase: wrap backups made by hand with an extra passphrase (LDJ-35) */
    encrypt?: boolean; passphrase: boolean; media: boolean };
  updates: { autoCheck: boolean; autoDownload: boolean; wifiOnly: boolean };
  layout: "auto" | "desktop" | "phone";
  /** Usual times (HH:MM): reality check reminders run from wake + 1 h to bedtime - 1 h (PLAN.md §9). */
  sleep: { bedtime: string; wake: string; /** Minutes, 60-120. */ cycle: number;
    /** "Nights I can sleep in" (LDJ-108): weekdays (0 Sunday ... 6 Saturday) of the evenings after which a lie-in is
     *  possible. Tonight's suggested plan puts WBTB only on these (tonight.ts). Plain weekdays, nothing personal. */
    freeNights: number[] };
  /** Learn: reading progress and self-assessment answers. No dream content, so these sync in the clear. */
  learn: {
    /** Article id to the ISO date it was read to the end. An empty string means marked unread by hand (the settings merge cannot delete a key). */
    read: Record<string, string>;
    /** Pinned items for quick access, in the order pinned: article ids, `lesson:<id>`, `term:<slug>`, `faq:<slug>`. Plain ids, nothing personal. */
    pinned: string[];
    /** The article opened last, for "Continue reading". */
    last: string;
    /** Dated answers per scale (ldfs, madre), oldest first. */
    assessments: Record<"ldfs" | "madre", { date: string; value: number }[]>;
  };
  /** Recommendations (recommend.ts): rule ids dismissed for 14 days and the day each was dismissed. No personal data. */
  recommend: { dismissed: Dismissal[] };
  /** Milestones whose moment has been shown (milestones.ts, LDJ-117): an id, the day and the dream. No personal data. */
  milestones: Milestones;
  /**
   * The first-run setup (LDJ-77): done once it has been finished or skipped, so it shows once. experience is the
   * answer to "how much lucid dreaming have you done" (it picked the starting lesson); empty when skipped. Plain
   * choices, nothing personal. goal is "what do you want from it" (LDJ-180), empty when skipped. recall is the setup's
   * self-assessment dream recall answer (a MADRE value, @somnium/knowledge/assessments), the baseline Progress · Recall
   * and Home set today's recall against (recallProgress's `said`); null when not answered in the setup.
   */
  setup: { done: boolean; experience: SetupExperience; goal: SetupGoal; recall: number | null };
  /** blocks: Home's blocks in the order shown, each shown or hidden (Edit home, from Home's ⋮ menu). Plain ids. */
  home: { blocks: HomeBlock[] };
  /** The morning capture (LDJ-80): dim, whether it opens on the still moment ("lie still and rewind") before the key
   *  words. A plain choice, nothing personal. */
  capture: { dim: boolean };
  /**
   * The safety check (LDJ-116, in setup and before WBTB). Only its outcome syncs: checked (it has been answered or
   * skipped) and sleepFirst (keep the techniques that cut into sleep, WBTB, the CAT alarm and naps, out of
   * suggestions). sleepFirst is a training preference anyone may choose and says nothing about why; the answers
   * themselves (which item was a yes) are personal health information, so they never reach the server, not even
   * sealed: they stay on the device (apps/web/src/components/setup/safety.ts).
   */
  safety: { checked: boolean; sleepFirst: boolean };
  /** The weekly review's choice (LDJ-155): sign is this week's target dream sign, an element id ("" for none). The id
   *  is opaque (the sign's name stays sealed), so it syncs in the clear like the other plain choices. */
  week: { sign: string };
}

export interface HomeBlock { id: string; on: boolean }
/** Every Home block, in the default order; `on` is whether a new account sees it. Goals and Day note also need their
 *  feature switched on, and are absent from Home and Edit home while it is off. Day note is off unless Edit home shows
 *  it: notes are written from the + sheet and live in the Journal (PLAN.md §6.2, LDJ-123). Ids added later are appended
 *  to a saved order. (Ported from Motus's HOME_BLOCKS.) */
export const HOME_BLOCKS: HomeBlock[] = [
  { id: "morning", on: true }, { id: "today", on: true }, { id: "tonight", on: true }, { id: "rates", on: true },
  { id: "goals", on: true }, { id: "dayNote", on: false },
  { id: "signs", on: false }, { id: "lesson", on: false }, { id: "tip", on: false }, { id: "lastLucid", on: false }, { id: "pastDream", on: false },
  { id: "path", on: false },
];
// Before Edit home these four cards were switches in Settings → Features; a layout never saved yet takes their state
const LEGACY_HOME: Record<string, string> = { signs: "homeSigns", lesson: "homeLesson", tip: "homeTip", lastLucid: "homeLastLucid" };
// shown on every Home, so Edit home gives them no switch
export const FIXED_HOME_BLOCKS = new Set(["morning", "today"]);

/** Home's blocks made safe (they sync from any device): repeats and malformed entries dropped, missing ones appended
 *  with their default. Ids this version doesn't know are kept as saved (a newer device added them; dropping them here
 *  would lose that device's choice when this one saves); the screens ignore them, and Reset replaces the list. With no saved layout, the old Features switches (features.homeSigns ...) carry over. */
export function cleanHomeBlocks(saved: unknown, features: Record<string, boolean> = {}): HomeBlock[] {
  const known = new Map(HOME_BLOCKS.map((x) => [x.id, x.on]));
  const out: HomeBlock[] = [];
  const seen = new Set<string>();
  if (Array.isArray(saved)) {
    for (const x of saved) {
      const item: { id?: unknown; on?: unknown } = x && typeof x === "object" ? x : {};
      const id = item.id;
      if (typeof id !== "string" || seen.has(id)) continue;
      seen.add(id);
      if (!known.has(id)) { out.push({ id, on: item.on === true }); continue; }
      out.push({ id, on: FIXED_HOME_BLOCKS.has(id) || (typeof item.on === "boolean" ? item.on : known.get(id)!) });
    }
  }
  const legacy = !Array.isArray(saved);
  for (const d of HOME_BLOCKS) if (!seen.has(d.id)) out.push({ id: d.id, on: legacy && LEGACY_HOME[d.id] && typeof features[LEGACY_HOME[d.id]!] === "boolean" ? features[LEGACY_HOME[d.id]!]! : d.on });
  return out;
}

export type SetupExperience = "" | "new" | "some" | "regular";
export type SetupGoal = "" | "first" | "often" | "longer" | "recall";

export const DEFAULT_SETTINGS: Settings = {
  firstDay: "auto",
  dateFormat: "auto",
  clock: "auto",
  features: FEATURE_DEFAULTS,
  notifications: { updates: true },
  backup: { on: true, every: "daily", at: "03:00", keep: 7, passphrase: false, media: true },
  updates: { autoCheck: true, autoDownload: true, wifiOnly: false },
  layout: "auto",
  sleep: { bedtime: "23:00", wake: "07:00", cycle: 90, freeNights: [] },
  learn: { read: {}, pinned: [], last: "", assessments: { ldfs: [], madre: [] } },
  recommend: { dismissed: [] },
  milestones: {},
  setup: { done: false, experience: "", goal: "", recall: null },
  home: { blocks: HOME_BLOCKS },
  capture: { dim: true },
  safety: { checked: false, sleepFirst: false },
  week: { sign: "" },
};

/** Deep-merges saved settings over the defaults, so new settings get their default value. */
export function withDefaults(saved: unknown): Settings {
  const merge = (d: any, s: any): any => {
    if (Array.isArray(d)) return Array.isArray(s) ? s : d;
    if (d && typeof d === "object") {
      const o: any = { ...d };
      if (s && typeof s === "object") for (const k of Object.keys(s)) o[k] = k in d ? merge(d[k], s[k]) : s[k];
      return o;
    }
    return s === undefined ? d : s;
  };
  const out: Settings = merge(DEFAULT_SETTINGS, saved);
  const blocks = saved && typeof saved === "object" ? (saved as { home?: { blocks?: unknown } }).home?.blocks : undefined;
  out.home = { ...out.home, blocks: cleanHomeBlocks(blocks, out.features) };
  for (const k of RETIRED_FEATURES) delete out.features[k];
  return out;
}

/** The three formats as concrete values: what "Automatic" means on one device. */
export interface DeviceFormats {
  firstDay: 0 | 1; dateFormat: "dmy" | "mdy" | "ymd"; clock: "24" | "12";
  /** True for a value the device did not tell us (a fallback), so the UI can say it is a guess. Absent means all known. */
  guessed?: { firstDay: boolean; dateFormat: boolean; clock: boolean };
}
export type ResolvedSettings = Omit<Settings, "firstDay" | "dateFormat" | "clock"> & DeviceFormats;

/**
 * Week start, date order and clock for a language, read from Intl (a locale such as "en-US"; the device's own when
 * omitted). Anything Intl cannot tell falls back to Monday, day-month-year and 24 hours, the old fixed defaults.
 */
export function deviceFormats(locale?: string): DeviceFormats {
  const guessed = { firstDay: true, dateFormat: true, clock: true };
  const out: DeviceFormats = { firstDay: 1, dateFormat: "dmy", clock: "24", guessed };
  try {
    const loc = locale ?? (typeof navigator !== "undefined" ? navigator.language : undefined);
    const l = new Intl.Locale(loc || "en-GB") as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const w = l.getWeekInfo?.() ?? l.weekInfo; // 1 Monday ... 7 Sunday; the picker offers Sunday or Monday
    if (w) { out.firstDay = w.firstDay === 7 ? 0 : 1; guessed.firstDay = false; } // Firefox has no week info
    const cycle = new Intl.DateTimeFormat(l.toString(), { hour: "numeric" }).resolvedOptions().hourCycle;
    if (cycle) { out.clock = cycle === "h11" || cycle === "h12" ? "12" : "24"; guessed.clock = false; }
    const order = new Intl.DateTimeFormat(l.toString(), { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" }).formatToParts(Date.UTC(2026, 11, 31))
      .map((p) => p.type).filter((x) => x === "year" || x === "month" || x === "day");
    if (order.length === 3) { out.dateFormat = order[0] === "year" ? "ymd" : order[0] === "month" ? "mdy" : "dmy"; guessed.dateFormat = false; }
  } catch { /* keep the fallbacks */ }
  return out;
}

/** The settings with "auto" in the three formats replaced by this device's values. */
export function resolveFormats(s: Settings, device: DeviceFormats = deviceFormats()): ResolvedSettings {
  return { ...s, firstDay: s.firstDay === "auto" ? device.firstDay : s.firstDay, dateFormat: s.dateFormat === "auto" ? device.dateFormat : s.dateFormat, clock: s.clock === "auto" ? device.clock : s.clock };
}
