// The Journal's pure logic (PLAN.md §6.2): nights grouped with their dreams, searching on the device, the month
// calendar, and how a draft kept on the device meets the row it belongs to. Nothing here reads the clock or storage.

import type { ElementKind } from "./types";
import { isPlanOnly, type NightLog } from "./rates";

/** The fields of a night and a dream this logic reads (rows from the engine, opened on the device). */
export interface NightRef { id: string; date: string; nap: boolean; dreamCount?: number }
export interface DreamRef {
  id: string; nightId: string; position: number; createdAt?: string;
  title: string | null; text: string | null; lucid: boolean; nightmare: boolean; favourite: boolean;
}
export interface NightGroup<N extends NightRef, D extends DreamRef> { night: N; dreams: D[] }

/** Nights newest first, each with its dreams in the order of the night. A night of the same date before its nap. */
export function groupByNight<N extends NightRef, D extends DreamRef>(nights: N[], dreams: D[]): NightGroup<N, D>[] {
  const by = new Map<string, D[]>();
  for (const d of dreams) { const l = by.get(d.nightId); if (l) l.push(d); else by.set(d.nightId, [d]); }
  const order = (a: D, b: D) => a.position - b.position || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || a.id.localeCompare(b.id);
  return [...nights]
    .sort((a, b) => b.date.localeCompare(a.date) || Number(a.nap) - Number(b.nap) || a.id.localeCompare(b.id))
    .map((night) => ({ night, dreams: (by.get(night.id) ?? []).slice().sort(order) }));
}

/**
 * The nights the Journal lists: a plan (Train's "Use tonight") is left out until something is written, and a night
 * of a coming morning shows only once it has a dream (written ahead, or the clock is off); the rest wait for it.
 */
export const journalNights = <N extends NightRef & NightLog>(nights: N[], today: string): N[] =>
  nights.filter((n) => !isPlanOnly(n) && (n.date <= today || (n.dreamCount ?? 0) > 0));

/** The night of a date (not a nap): one per date is the rule (PLAN.md §5). */
export const nightOfDate = <N extends NightRef>(nights: N[], date: string): N | undefined => nights.find((n) => n.date === date && !n.nap);

export interface JournalFilter { text?: string; elementIds?: string[]; from?: string; to?: string; lucidOnly?: boolean }
/** Whether anything narrows the list at all. */
export const filterActive = (f: JournalFilter): boolean => !!(f.text?.trim() || f.elementIds?.length || f.from || f.to || f.lucidOnly);

/** Lower case, accents gone, so "Café" finds "cafe". */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Whether a dream matches: every word of the text is somewhere in its title, text or element names; it has every
 * chosen element; its night is in the dates; and it is lucid if only lucid ones are wanted.
 */
export function matchDream(d: DreamRef, date: string, elements: { id: string; name: string | null }[], f: JournalFilter): boolean {
  if (f.lucidOnly && !d.lucid) return false;
  if (f.from && date < f.from) return false;
  if (f.to && date > f.to) return false;
  if (f.elementIds?.length && !f.elementIds.every((id) => elements.some((e) => e.id === id))) return false;
  const words = fold(f.text ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([d.title ?? "", d.text ?? "", ...elements.map((e) => e.name ?? "")].join("\n"));
  return words.every((w) => hay.includes(w));
}

/**
 * The groups that match. A night without dreams ("no recall") stays only when the filter is no more than dates:
 * it has nothing a text, an element or "lucid only" could match.
 */
export function searchJournal<N extends NightRef, D extends DreamRef>(
  groups: NightGroup<N, D>[], elementsOf: (dreamId: string) => { id: string; name: string | null }[], f: JournalFilter,
): NightGroup<N, D>[] {
  if (!filterActive(f)) return groups;
  const datesOnly = !f.text?.trim() && !f.elementIds?.length && !f.lucidOnly;
  const out: NightGroup<N, D>[] = [];
  for (const g of groups) {
    if (!g.dreams.length) {
      if (datesOnly && (!f.from || g.night.date >= f.from) && (!f.to || g.night.date <= f.to)) out.push(g);
      continue;
    }
    const dreams = g.dreams.filter((d) => matchDream(d, g.night.date, elementsOf(d.id), f));
    if (dreams.length) out.push({ night: g.night, dreams });
  }
  return out;
}

/** What the calendar shows on a day: lucid dreams apart from the others, and whether the night was logged without recall. */
export interface DayMark { lucid: number; other: number; noRecall: boolean }
export function dayMarks<N extends NightRef, D extends DreamRef>(groups: NightGroup<N, D>[]): Map<string, DayMark> {
  const m = new Map<string, DayMark>();
  for (const g of groups) {
    const x = m.get(g.night.date) ?? { lucid: 0, other: 0, noRecall: false };
    for (const d of g.dreams) if (d.lucid) x.lucid++; else x.other++;
    if (!g.dreams.length && !g.night.nap) x.noRecall = true;
    m.set(g.night.date, x);
  }
  for (const x of m.values()) if (x.lucid + x.other > 0) x.noRecall = false;
  return m;
}

/** The days (YYYY-MM-DD) of the weeks a month touches, starting on firstDay (0 Sunday, 1 Monday). month is 1-12. */
export function monthGrid(year: number, month: number, firstDay: number): string[] {
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() - firstDay + 7) % 7));
  const last = new Date(Date.UTC(year, month, 0));
  const out: string[] = [];
  for (const d = new Date(start); d <= last || out.length % 7; d.setUTCDate(d.getUTCDate() + 1)) out.push(ymd(d));
  return out;
}

/** The month before or after "YYYY-MM". */
export function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * A draft kept on the device while the server can't take it yet (offline, locked, or the page closed mid-save).
 * It carries the dream's own id and only names its night (night id and date), so a night made offline can later be
 * swapped for the one already there on that date without touching the dream (LDJ-52 merges same-night dreams).
 */
export interface DreamDraft {
  dreamId: string;
  nightId: string;
  date: string;
  /** every field of the dream as the person left it (title, text, marks, scales) */
  dream: Record<string, unknown>;
  /** the night's fields the person changed in the night details sheet */
  night: Record<string, unknown>;
  /** element ids linked and unlinked here, not yet sent */
  link: string[];
  unlink: string[];
  /** elements made here, not yet sent (a confirmed suggestion may bring aliases, or mark a dream sign) */
  newElements: { id: string; name: string; kind: string; aliases?: string | null; isDreamSign?: boolean; signCategory?: string | null }[];
  /** how a link was made, for links that came from a confirmed suggestion (LDJ-18); others are manual */
  linkMeta?: Record<string, { source: "detected" | "ocr"; confidence: number | null; span: string | null }>;
  /** new aliases of the person's existing elements, learned from confirmed suggestions, not yet sent */
  aliases?: Record<string, string>;
  /** when the person last changed it (ms) */
  savedAt: number;
}

/**
 * The dream as the editor should show it: the draft over the row when the draft is newer than the row's last
 * change, otherwise the row (another device wrote it since). Either may be missing.
 */
export function mergeDraft<R extends Record<string, unknown>>(row: (R & { updatedAt?: string }) | null | undefined, draft: DreamDraft | null | undefined): Record<string, unknown> {
  if (!draft) return { ...(row ?? {}) };
  if (!row) return { ...draft.dream, id: draft.dreamId, nightId: draft.nightId };
  const rowAt = row.updatedAt ? Date.parse(row.updatedAt) : 0;
  if (rowAt > draft.savedAt) return { ...row };
  return { ...row, ...draft.dream, id: row.id ?? draft.dreamId, nightId: draft.nightId };
}

/** The element links once a draft's own changes are applied over the ones the row has. */
export function mergeLinks(rowLinks: string[], draft: Pick<DreamDraft, "link" | "unlink"> | null | undefined): string[] {
  const out = rowLinks.filter((id) => !draft?.unlink.includes(id));
  for (const id of draft?.link ?? []) if (!out.includes(id)) out.push(id);
  return out;
}

/** Element names that start with (then contain) what was typed, best first, without the ones already chosen. */
export function elementMatches<E extends { id: string; name: string | null }>(all: E[], typed: string, chosen: string[], max = 8): E[] {
  const t = fold(typed.trim());
  if (!t) return [];
  const live = all.filter((e) => e.name && !chosen.includes(e.id));
  const starts = live.filter((e) => fold(e.name!).startsWith(t));
  const has = live.filter((e) => !starts.includes(e) && fold(e.name!).includes(t));
  return [...starts, ...has].slice(0, max);
}

/** "HH:MM" on the evening before (a bedtime from noon on) or the morning of a night's date, as an ISO time. */
export function nightClock(date: string, hhmm: string, kind: "bed" | "wake"): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const h = Number(m[1]), mi = Number(m[2]);
  const day = kind === "bed" && h >= 12 ? d - 1 : d;
  return new Date(y, mo - 1, day, h, mi).toISOString();
}
/** The "HH:MM" of an ISO time, on this device's clock. */
export function clockOf(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

// The scales and their one-line anchors (PLAN.md §7.4). Lucidity is adapted from the DLQ and Waggoner (RESEARCH.md).
export const LUCIDITY_ANCHORS = ["Not lucid", "A brief flash, lost at once", "Knew, but little clarity or control", "Lucid, some control", "Lucid, clear and in control", "Fully lucid, long and stable"] as const;
export const CONTROL_ANCHORS = ["No control", "A small nudge", "A few things went my way", "Steered some of it", "Steered most of it", "Full control"] as const;
/** index 0 is score 1 */
export const VIVIDNESS_ANCHORS = ["Faint, like a vague memory", "Dim, few details", "Clear, like an ordinary day", "Vivid, rich in detail", "More vivid than waking life"] as const;
export const RECALL_ANCHORS = ["Only a fragment", "A few scenes", "Most of the story", "Nearly all of it, in order", "All of it, in detail"] as const;
export const SLEEP_ANCHORS = ["Very poor", "Poor", "Fair", "Good", "Very good"] as const;
/** index 0 is -2 */
export const EMOTION_ANCHORS = ["Very unpleasant", "Unpleasant", "Neutral or mixed", "Pleasant", "Very pleasant"] as const;

/** The techniques a night can name, by their Learn article ids. */
export const TECHNIQUES: readonly { id: string; label: string }[] = [
  { id: "reality-testing", label: "Reality checks" }, { id: "mild", label: "MILD" }, { id: "wbtb", label: "WBTB" },
  { id: "ssild", label: "SSILD" }, { id: "wild", label: "WILD" }, { id: "fild", label: "FILD" }, { id: "deild", label: "DEILD" },
  { id: "vild", label: "VILD" }, { id: "dream-signs", label: "Dream signs" }, { id: "incubation", label: "Incubation" },
  { id: "autosuggestion", label: "Autosuggestion" }, { id: "meditation", label: "Meditation" }, { id: "sound-cue", label: "Sound cue" },
  { id: "re-entry", label: "Re-entry" }, { id: "ada", label: "All-day awareness" }, { id: "cat", label: "CAT" },
];

/** The kinds of element, as the person reads them. */
export const ELEMENT_KIND_LABEL: Record<ElementKind, string> = {
  character: "Character", place: "Place", object: "Object", action: "Action", emotion: "Emotion", theme: "Theme",
  sensation: "Sensation", dream_sign: "Dream sign",
};
/** The kinds a new element can be given while writing (sensations and dream signs are set in Signs, PLAN.md §6.3). */
export const NEW_ELEMENT_KINDS = ["character", "place", "object", "action", "emotion", "theme"] as const satisfies readonly ElementKind[];
