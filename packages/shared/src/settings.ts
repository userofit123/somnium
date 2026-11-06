// A person's settings, with defaults. Stored as JSON per user; missing keys fall back to these.
// Nothing personal lives here (PLAN.md §4): these are preferences, and they sync in the clear.
import { FEATURE_DEFAULTS } from "./features";

export interface Settings {
  firstDay: 0 | 1;
  dateFormat: "dmy" | "mdy" | "ymd";
  clock: "24" | "12";
  features: Record<string, boolean>;
  notifications: { updates: boolean };
  backup: { on: boolean; every: "daily" | "weekly"; at: string; keep: number; encrypt: boolean; media: boolean };
  updates: { autoCheck: boolean; autoDownload: boolean; wifiOnly: boolean };
  layout: "auto" | "desktop" | "phone";
}

export const DEFAULT_SETTINGS: Settings = {
  firstDay: 1,
  dateFormat: "dmy",
  clock: "24",
  features: FEATURE_DEFAULTS,
  notifications: { updates: true },
  backup: { on: true, every: "daily", at: "03:00", keep: 14, encrypt: true, media: true },
  updates: { autoCheck: true, autoDownload: true, wifiOnly: false },
  layout: "auto",
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
  return merge(DEFAULT_SETTINGS, saved);
}
