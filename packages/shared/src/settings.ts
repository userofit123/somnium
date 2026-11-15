// A person's settings, with defaults. Stored as JSON per user; missing keys fall back to these.
// Nothing personal lives here (PLAN.md §4): these are preferences, and they sync in the clear.
import { FEATURE_DEFAULTS } from "./features";
import type { Dismissal } from "./recommend";

export interface Settings {
  firstDay: 0 | 1;
  dateFormat: "dmy" | "mdy" | "ymd";
  clock: "24" | "12";
  features: Record<string, boolean>;
  notifications: { updates: boolean };
  backup: { on: boolean; every: "daily" | "weekly"; at: string; keep: number; /** encrypt: the old password-encrypted backups, no longer read; passphrase: wrap backups made by hand with an extra passphrase (LDJ-35) */
    encrypt?: boolean; passphrase: boolean; media: boolean };
  updates: { autoCheck: boolean; autoDownload: boolean; wifiOnly: boolean };
  layout: "auto" | "desktop" | "phone";
  /** Usual times (HH:MM): reality check reminders run from wake + 1 h to bedtime - 1 h (PLAN.md §9). */
  sleep: { bedtime: string; wake: string; /** Minutes, 60-120. */ cycle: number };
  /** Learn: reading progress and "Where am I" answers. No dream content, so these sync in the clear. */
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
  /**
   * The first-run setup (LDJ-77): done once it has been finished or skipped, so it shows once. experience is the
   * answer to "how much lucid dreaming have you done" (it picked the starting lesson); empty when skipped. Plain
   * choices, nothing personal.
   */
  setup: { done: boolean; experience: SetupExperience };
  /** blocks: Home's blocks in the order shown, each shown or hidden (Edit home, from Home's ⋮ menu). Plain ids. */
  home: { blocks: HomeBlock[] };
}

export interface HomeBlock { id: string; on: boolean }
/** Every Home block, in the default order; `on` is whether a new account sees it. Goals and Day note also need their
 *  feature switched on, and are absent from Home and Edit home while it is off. Ids added later are appended to a saved
 *  order. (Ported from Motus's HOME_BLOCKS.) */
export const HOME_BLOCKS: HomeBlock[] = [
  { id: "morning", on: true }, { id: "today", on: true }, { id: "tonight", on: true }, { id: "rates", on: true },
  { id: "goals", on: true }, { id: "dayNote", on: true },
  { id: "signs", on: false }, { id: "lesson", on: false }, { id: "tip", on: false }, { id: "lastLucid", on: false },
];
// Before Edit home these four cards were switches in Settings → Features; a layout never saved yet takes their state
const LEGACY_HOME: Record<string, string> = { signs: "homeSigns", lesson: "homeLesson", tip: "homeTip", lastLucid: "homeLastLucid" };
// shown on every Home, so Edit home gives them no switch
export const FIXED_HOME_BLOCKS = new Set(["morning", "today"]);

/** Home's blocks made safe (they sync from any device): unknown ids and repeats dropped, missing ones appended with
 *  their default. With no saved layout, the old Features switches (features.homeSigns ...) carry over. */
export function cleanHomeBlocks(saved: unknown, features: Record<string, boolean> = {}): HomeBlock[] {
  const known = new Map(HOME_BLOCKS.map((x) => [x.id, x.on]));
  const out: HomeBlock[] = [];
  const seen = new Set<string>();
  if (Array.isArray(saved)) {
    for (const x of saved) {
      const item: { id?: unknown; on?: unknown } = x && typeof x === "object" ? x : {};
      const id = item.id;
      if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, on: FIXED_HOME_BLOCKS.has(id) || (typeof item.on === "boolean" ? item.on : known.get(id)!) });
    }
  }
  const legacy = !Array.isArray(saved);
  for (const d of HOME_BLOCKS) if (!seen.has(d.id)) out.push({ id: d.id, on: legacy && LEGACY_HOME[d.id] && typeof features[LEGACY_HOME[d.id]!] === "boolean" ? features[LEGACY_HOME[d.id]!]! : d.on });
  return out;
}

export type SetupExperience = "" | "new" | "some" | "regular";

export const DEFAULT_SETTINGS: Settings = {
  firstDay: 1,
  dateFormat: "dmy",
  clock: "24",
  features: FEATURE_DEFAULTS,
  notifications: { updates: true },
  backup: { on: true, every: "daily", at: "03:00", keep: 7, passphrase: false, media: true },
  updates: { autoCheck: true, autoDownload: true, wifiOnly: false },
  layout: "auto",
  sleep: { bedtime: "23:00", wake: "07:00", cycle: 90 },
  learn: { read: {}, pinned: [], last: "", assessments: { ldfs: [], madre: [] } },
  recommend: { dismissed: [] },
  setup: { done: false, experience: "" },
  home: { blocks: HOME_BLOCKS },
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
  return out;
}
