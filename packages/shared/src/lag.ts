// Day notes and the dream-lag view (PLAN.md §7.2, LDJ-41; RESEARCH.md 2.9). For each element named in a day note, did it
// show up in a dream 1-2 days later (the day-residue window) or 5-7 days later (the dream-lag window of Nielsen and
// Powell, [23], replicated in [48]; Blagrove et al. [24] found the 5-7 day lag against a baseline)? Pure: counted on the
// device from the sealed texts it has opened, nothing is sent anywhere. The counts come with a baseline (how often any
// day in the same stretch is followed by such a dream) so the numbers can't read stronger than they are.
import { addDays } from "./rates";
import type { SignDream, SignLink } from "./signs";

export interface LagNote { date: string; text: string | null }
export interface LagElement { id: string; name: string | null; aliases?: string | null }

/** Fewer than this many noted days for an element: no wording about it. */
export const LAG_MIN_MENTIONS = 3;
export const RESIDUE_DAYS: readonly [number, number] = [1, 2];
export const LAG_DAYS: readonly [number, number] = [5, 7];
export const LAG_SOURCES = ["23", "24", "48"] as const;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The words an element answers to: its name and its aliases (split on commas, semicolons and new lines), 3+ letters. */
export const elementWords = (e: LagElement): string[] =>
  [e.name ?? "", ...(e.aliases ?? "").split(/[,;\n]/)].map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 3);

/** Whether the note names the element: a whole-word match of the name or an alias, any case. */
export function mentions(text: string | null | undefined, e: LagElement): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return elementWords(e).some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}($|[^\\p{L}\\p{N}])`, "u").test(t));
}

export interface LagWindow {
  /** noted days whose whole window is already over */
  of: number;
  /** of those, the days with a dream holding the element inside the window */
  hit: number;
  /** the same share over every day from the first to the last noted day, noted or not: what chance alone gives */
  baseline: number | null;
}
export interface LagRow { elementId: string; name: string; days: number; residue: LagWindow; lag: LagWindow; enough: boolean }

/** Dates (YYYY-MM-DD) of the dreams that hold each element. */
function dreamDates(links: readonly SignLink[], dreams: readonly SignDream[]): Map<string, Set<string>> {
  const date = new Map(dreams.map((d) => [d.id, d.date]));
  const out = new Map<string, Set<string>>();
  for (const l of links) {
    const d = date.get(l.dreamId);
    if (!d) continue;
    (out.get(l.elementId) ?? out.set(l.elementId, new Set()).get(l.elementId)!).add(d);
  }
  return out;
}
const inWindow = (dates: Set<string> | undefined, from: string, [a, b]: readonly [number, number]) => {
  if (!dates) return false;
  for (let k = a; k <= b; k++) if (dates.has(addDays(from, k))) return true;
  return false;
};
function windowOf(days: string[], dates: Set<string> | undefined, w: readonly [number, number], today: string, first: string, last: string): LagWindow {
  const over = (d: string) => addDays(d, w[1]) <= today;
  const eligible = days.filter(over);
  let all = 0, allHit = 0;
  for (let d = first, n = 0; d <= last && n < 4000; d = addDays(d, 1), n++) if (over(d)) { all++; if (inWindow(dates, d, w)) allHit++; }
  return { of: eligible.length, hit: eligible.filter((d) => inWindow(dates, d, w)).length, baseline: all ? allHit / all : null };
}

/** The rows for the elements named in at least one day note, the most noted first. */
export function lagAnalysis(notes: readonly LagNote[], elements: readonly LagElement[], links: readonly SignLink[], dreams: readonly SignDream[], today: string): LagRow[] {
  const dates = dreamDates(links, dreams);
  const noted = notes.filter((n) => n.text);
  if (!noted.length) return [];
  const rows: LagRow[] = [];
  for (const e of elements) {
    if (!e.name) continue;
    const days = [...new Set(noted.filter((n) => mentions(n.text, e)).map((n) => n.date))].sort();
    if (!days.length) continue;
    const ds = dates.get(e.id);
    const first = days[0]!, last = days[days.length - 1]!;
    rows.push({
      elementId: e.id, name: e.name, days: days.length,
      residue: windowOf(days, ds, RESIDUE_DAYS, today, first, last),
      lag: windowOf(days, ds, LAG_DAYS, today, first, last),
      enough: days.length >= LAG_MIN_MENTIONS,
    });
  }
  return rows.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** One window as a plain line: "appeared in a dream 1-2 days after you wrote about it: 2 of 4 times (chance alone: 25%)". */
export function lagLine(w: LagWindow, label: string): string {
  if (!w.of) return `${label}: too soon to tell`;
  const base = w.baseline != null ? ` (any day in the same stretch: ${pct(w.baseline)})` : "";
  return `${label}: ${w.hit} of ${w.of} ${w.of === 1 ? "time" : "times"}${base}`;
}
export const RESIDUE_LABEL = "In a dream 1-2 days after you wrote about it";
export const LAG_LABEL = "In a dream 5-7 days after you wrote about it";
/** The caution shown under the card; the effect is small and mixed in the studies, so this is a count, not a finding. */
export const LAG_CAVEAT = "These are counts from your own notes, not a test. Studies found the 5-7 day delay in some groups and not in others, and things you write about are often the things you keep thinking about, so a match does not show cause.";
