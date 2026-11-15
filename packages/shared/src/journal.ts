// The Journal's pure logic (PLAN.md §6.2): nights grouped with their dreams, searching on the device, the month
// calendar, and how a draft kept on the device meets the row it belongs to. Nothing here reads the clock or storage.

import type { BecameLucidHow, ElementKind, LucidEnd } from "./types";
import { isPlanOnly, minutesToSleep, type NightLog } from "./rates";

/** The fields of a night and a dream this logic reads (rows from the engine, opened on the device). */
export interface NightRef { id: string; date: string; nap: boolean; dreamCount?: number; techniquesDone?: string[] | null; wbtbUsed?: boolean | null }
export interface DreamRef {
  id: string; nightId: string; position: number; createdAt?: string;
  title: string | null; text: string | null; lucid: boolean; nightmare: boolean; favourite: boolean;
  badDream?: boolean; recurring?: boolean; falseAwakening?: boolean; sleepParalysis?: boolean;
  /** saved as key words by the morning capture, not yet written out (LDJ-80, LDJ-162) */
  unfinished?: boolean;
}

/**
 * Nightmare or bad dream: the line Zadra and Donderi (2000) drew, whether it woke you (RESEARCH.md C18, C19). A dream
 * is one or the other, never both (the engine keeps that too). The hint the editor shows under the two marks.
 */
export const UPSET_HINT = "A nightmare wakes you up. A bad dream is upsetting too, but you sleep on.";
export const UPSET_SOURCES = ["C18"] as const;
/** The marks a dream's line in the Journal shows, in this order (a dream marked both reads as a nightmare). */
export function dreamListMarks(d: Pick<DreamRef, "lucid" | "nightmare" | "badDream" | "recurring" | "falseAwakening"> & { lucidityLevel?: number | null }): string[] {
  return [
    d.lucid ? `Lucid${d.lucidityLevel ? " " + d.lucidityLevel : ""}` : "",
    d.nightmare ? "Nightmare" : d.badDream ? "Bad dream" : "",
    d.recurring ? "Recurring" : "",
    d.falseAwakening ? "False awakening" : "",
  ].filter(Boolean);
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

/** The dream marks the filter can ask for (LDJ-163): pulling up "all my nightmares" is how a person finds their own
 *  patterns (RESEARCH.md Part C §5.1). Unfinished is a dream saved as key words, still to write out. */
export const DREAM_FILTER_MARKS = [
  { key: "nightmare", label: "Nightmare" }, { key: "badDream", label: "Bad dream" }, { key: "recurring", label: "Recurring" },
  { key: "favourite", label: "Favourite" }, { key: "falseAwakening", label: "False awakening" },
  { key: "sleepParalysis", label: "Sleep paralysis" }, { key: "unfinished", label: "Unfinished" },
] as const;
export type DreamFilterMark = (typeof DREAM_FILTER_MARKS)[number]["key"];
/** What the filter's Night group asks for: a technique id done that night (WBTB included however it was logged), or "nap". */
export const NAP_FILTER = "nap";

export interface JournalFilter {
  text?: string; elementIds?: string[]; from?: string; to?: string; lucidOnly?: boolean;
  /** the dream has every one of these marks */
  marks?: DreamFilterMark[];
  /** the dream's night had every one of these: technique ids (techniquesDoneOf) or NAP_FILTER */
  night?: string[];
}
/** Whether anything narrows the list at all. */
export const filterActive = (f: JournalFilter): boolean =>
  !!(f.text?.trim() || f.elementIds?.length || f.from || f.to || f.lucidOnly || f.marks?.length || f.night?.length);

/** Lower case, accents gone, so "Café" finds "cafe". */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Whether a night had everything the Night group asks for. */
export function nightMatches(n: Pick<NightRef, "nap" | "techniquesDone" | "wbtbUsed">, want: readonly string[] | undefined): boolean {
  if (!want?.length) return true;
  const done = techniquesDoneOf(n);
  return want.every((w) => (w === NAP_FILTER ? n.nap : done.includes(w)));
}

/**
 * Whether a dream matches: every word of the text is somewhere in its title, text or element names; it has every
 * chosen element and mark; its night is in the dates; and it is lucid if only lucid ones are wanted.
 * The Night group is checked per night, by searchJournal.
 */
export function matchDream(d: DreamRef, date: string, elements: { id: string; name: string | null }[], f: JournalFilter): boolean {
  if (f.lucidOnly && !d.lucid) return false;
  if (f.marks?.length && !f.marks.every((m) => !!d[m])) return false;
  if (f.from && date < f.from) return false;
  if (f.to && date > f.to) return false;
  if (f.elementIds?.length && !f.elementIds.every((id) => elements.some((e) => e.id === id))) return false;
  const words = fold(f.text ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([d.title ?? "", d.text ?? "", ...elements.map((e) => e.name ?? "")].join("\n"));
  return words.every((w) => hay.includes(w));
}

/**
 * The groups that match. A night without dreams ("no recall") stays only when the filter is no more than dates and
 * the Night group: it has nothing a text, an element, a mark or "lucid only" could match.
 */
export function searchJournal<N extends NightRef, D extends DreamRef>(
  groups: NightGroup<N, D>[], elementsOf: (dreamId: string) => { id: string; name: string | null }[], f: JournalFilter,
): NightGroup<N, D>[] {
  if (!filterActive(f)) return groups;
  const nightOnly = !f.text?.trim() && !f.elementIds?.length && !f.lucidOnly && !f.marks?.length;
  const out: NightGroup<N, D>[] = [];
  for (const g of groups) {
    if (!nightMatches(g.night, f.night)) continue;
    if (!g.dreams.length) {
      if (nightOnly && (!f.from || g.night.date >= f.from) && (!f.to || g.night.date <= f.to)) out.push(g);
      continue;
    }
    const dreams = g.dreams.filter((d) => matchDream(d, g.night.date, elementsOf(d.id), f));
    if (dreams.length) out.push({ night: g.night, dreams });
  }
  return out;
}

/** How many dreams the groups hold and how many of them are lucid: "12 dreams · 3 lucid". */
export function journalCount<D extends DreamRef>(groups: NightGroup<NightRef, D>[]): { dreams: number; lucid: number } {
  let dreams = 0, lucid = 0;
  for (const g of groups) for (const d of g.dreams) { dreams++; if (d.lucid) lucid++; }
  return { dreams, lucid };
}

/** The dreams of a night still saved as key words (Home's morning card and the Journal list mark them, LDJ-162). */
export const unfinishedOf = <D extends Pick<DreamRef, "unfinished">>(dreams: readonly D[]): D[] => dreams.filter((d) => !!d.unfinished);

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
  /** dream sign marks the person set on elements from this editor, not yet sent: sent after the new elements are made,
   * and kept until they have gone, so a save cut short between making an element and saving the dream loses none */
  flags?: Record<string, { isDreamSign: boolean }>;
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

// A lucid dream's own questions (LDJ-78), one tap each: how you knew, how long, how it ended. Knowing which route
// gets you lucid is what personal training is built on: noticing a dream sign (LaBerge, RESEARCH.md C1) and asking
// the critical question (Tholey, D1, D6) are separate routes, and after WBTB most lucidity starts in the dream
// (Aspy, B38, D13).
export const LUCID_SOURCES = ["C1", "D1", "D6", "B38", "D13"] as const;
/** How you knew it was a dream, in the editor's words; "spontaneous" reads as "it just happened". */
export const BECAME_LUCID_LABEL: Record<BecameLucidHow, string> = {
  dream_sign: "A dream sign", reality_check: "A reality check", wild: "From waking (WILD)", nightmare: "A nightmare",
  spontaneous: "It just happened", other: "Other",
};
/** The editor's order (the ways people train first). */
export const BECAME_LUCID_ORDER: readonly BecameLucidHow[] = ["dream_sign", "reality_check", "wild", "nightmare", "spontaneous", "other"];
/**
 * How long it stayed lucid: rough steps, since nobody times a dream. Each is kept as whole minutes in the dream's
 * duration_est (a plain number the engine already has), and read back by lucidLength.
 */
export const LUCID_LENGTHS = [
  { key: "seconds", label: "Seconds", minutes: 0 },
  { key: "under_minute", label: "Under a minute", minutes: 1 },
  { key: "few_minutes", label: "A few minutes", minutes: 3 },
  { key: "longer", label: "Longer", minutes: 10 },
] as const;
export type LucidLength = (typeof LUCID_LENGTHS)[number]["key"];
/** The step a stored number of minutes falls in (a value typed elsewhere still lands on the nearest step). */
export function lucidLength(minutes: number | null | undefined): LucidLength | null {
  if (minutes == null) return null;
  return minutes < 1 ? "seconds" : minutes < 2 ? "under_minute" : minutes < 10 ? "few_minutes" : "longer";
}
export const LUCID_END_LABEL: Record<LucidEnd, string> = {
  woke: "Woke up", lost: "Lost lucidity", faded: "Faded", still_going: "Still going when I woke",
};

/** The techniques a night can name, by their Learn article ids. */
export const TECHNIQUES: readonly { id: string; label: string }[] = [
  { id: "reality-testing", label: "Reality checks" }, { id: "mild", label: "MILD" }, { id: "wbtb", label: "WBTB" },
  { id: "ssild", label: "SSILD" }, { id: "wild", label: "WILD" }, { id: "fild", label: "FILD" }, { id: "deild", label: "DEILD" },
  { id: "vild", label: "VILD" }, { id: "dream-signs", label: "Dream signs" }, { id: "incubation", label: "Incubation" },
  { id: "autosuggestion", label: "Autosuggestion" }, { id: "meditation", label: "Meditation" }, { id: "sound-cue", label: "Sound cue" },
  { id: "re-entry", label: "Re-entry" }, { id: "ada", label: "All-day awareness" }, { id: "cat", label: "CAT" },
];

const techLabel = (id: string) => TECHNIQUES.find((t) => t.id === id)?.label ?? id;

// ---------- the morning's night question (LDJ-79) ----------
// "What works for you" compares nights with and without each technique, so it needs every night's techniques, not
// only the ones a guided screen logged. The morning asks once, in a tap per technique.

/** The fields of a night the question reads. */
export interface CheckInNight { techniquesPlanned?: string[] | null; techniquesDone?: string[] | null; wbtbUsed?: boolean | null; minutesToSleep?: string | number | null }

/** The techniques done on a night, WBTB included when "I'm up" or Night details logged it as wbtb_used rather than in
 *  techniques_done: the two are one fact, and the morning's question must not ask again about a WBTB already logged. */
export function techniquesDoneOf(n: { techniquesDone?: string[] | null; wbtbUsed?: boolean | null }): string[] {
  const done = [...(n.techniquesDone ?? [])];
  if (n.wbtbUsed && !done.includes("wbtb")) done.push("wbtb");
  return done;
}
/** Techniques asked about when nothing was planned and too little was logged to know the person's own (Learn's core four). */
export const CHECK_IN_DEFAULTS = ["mild", "wbtb", "reality-testing", "ssild"] as const;
/** After these, how long it took to fall asleep is asked: Aspy's studies tie it to lucid nights (RESEARCH.md [37][38]). */
export const ASKS_ASLEEP: readonly string[] = ["mild", "ssild"];
/** The answers to "How long to fall asleep after it?", each stored as a number of minutes that lands in its band
 *  (Insights compares within 10 minutes with longer, ASLEEP_WITHIN). */
export const ASLEEP_CHIPS = [
  { label: "Under 5 min", minutes: 4 }, { label: "5-10 min", minutes: 8 }, { label: "10-20 min", minutes: 15 }, { label: "Longer", minutes: 30 },
] as const;
/** Which chip a stored number of minutes reads as (-1 when none is logged). */
export function asleepChip(minutes: number | null): number {
  if (minutes == null) return -1;
  return minutes < 5 ? 0 : minutes <= 10 ? 1 : minutes <= 20 ? 2 : 3;
}

/**
 * What the morning asks about a night: the techniques planned for it (Tonight's "Use tonight"), or with no plan the
 * four the person logs most (topped up from CHECK_IN_DEFAULTS), with anything already logged on the night first.
 */
export function checkInTechniques(night: CheckInNight, nights: readonly CheckInNight[]): { planned: boolean; ids: string[] } {
  const known = (id: string) => TECHNIQUES.some((t) => t.id === id);
  const planned = [...new Set((night.techniquesPlanned ?? []).filter(known))];
  if (planned.length) return { planned: true, ids: planned };
  const used = new Map<string, number>();
  for (const n of nights) for (const t of new Set(n.techniquesDone ?? [])) if (known(t)) used.set(t, (used.get(t) ?? 0) + 1);
  const top = [...used].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const done = techniquesDoneOf(night);
  const ids = [...new Set([...done.filter(known), ...top.slice(0, 4), ...CHECK_IN_DEFAULTS])];
  return { planned: false, ids: ids.slice(0, Math.max(4, done.length)) };
}

/** Whether the night already holds the answer: every planned technique logged, and the minutes to sleep when MILD or
 *  SSILD was. A "No" leaves nothing on the night, so the screens also remember on the device that it was answered. */
export function checkInAnswered(night: CheckInNight): boolean {
  const done = techniquesDoneOf(night);
  if (!done.length) return false;
  if (!(night.techniquesPlanned ?? []).every((t) => done.includes(t))) return false;
  return !done.some((t) => ASKS_ASLEEP.includes(t)) || minutesToSleep(night) != null;
}

/** A night's details on one line for the Journal (LDJ-99): "Bed 23:10 · Woke 07:05 · MILD", "" when none are logged. */
export function nightLine(n: { bedtime?: string | null; wakeTime?: string | null; techniquesDone?: string[] | null; wbtbUsed?: boolean | null }): string {
  const tech = techniquesDoneOf(n);
  return [n.bedtime ? `Bed ${clockOf(n.bedtime)}` : "", n.wakeTime ? `Woke ${clockOf(n.wakeTime)}` : "", ...tech.map(techLabel)].filter(Boolean).join(" · ");
}

/** The kinds of element, as the person reads them. */
export const ELEMENT_KIND_LABEL: Record<ElementKind, string> = {
  character: "Character", place: "Place", object: "Object", action: "Action", emotion: "Emotion", theme: "Theme",
  sensation: "Sensation", dream_sign: "Dream sign",
};
/** The kinds a new element can be given while writing (sensations and dream signs are set in Signs, PLAN.md §6.3). */
export const NEW_ELEMENT_KINDS = ["character", "place", "object", "action", "emotion", "theme"] as const satisfies readonly ElementKind[];
