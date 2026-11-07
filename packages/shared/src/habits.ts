// Practice habits and prospective-memory training (PLAN.md §6.4, LDJ-26 and LDJ-50). Pure: dates are local
// YYYY-MM-DD, `today` is passed in, nothing reads a clock or a store. Ticks live in practice_log under the stable item
// ids below; nothing in them is personal (target ids come from the fixed list, never typed text).
import { addDays } from "./rates";

export interface Tick { date: string; item: string; done: boolean }

/** The four core habits: the daily checklist, and the "days with all done" streak counts these only. */
export const CORE_HABITS = [
  { id: "habit:journal", name: "Write in the journal", auto: "Ticks itself when you log a dream or no recall today." },
  { id: "habit:checks", name: "Do your reality checks", auto: "Ticks itself when today's count reaches your target." },
  { id: "habit:sign", name: "Read about your top dream sign", auto: "Ticks when you open it." },
  { id: "habit:review", name: "Evening review", auto: "A short screen: tomorrow's intention and your top sign." },
] as const;
export const CORE_HABIT_IDS: readonly string[] = CORE_HABITS.map((h) => h.id);

/** Optional habits (Settings → Features, off by default). */
export const MEDITATION_HABIT = "habit:meditation";
export const MEDITATION_MINUTES = [5, 10, 15, 20] as const;
// Wangyal's four foundational practices (RESEARCH.md Part D, 5.2): a tradition, not a scientific claim.
export const DREAM_YOGA_PRACTICES = [
  { id: "habit:yoga-1", name: "Changing karmic traces", when: "Through the day", text: 'Think "I am awake in a dream" or "This is a dream" and become fully present; check that presence actually increases rather than repeating the phrase mechanically.' },
  { id: "habit:yoga-2", name: "Removing grasping and aversion", when: "When a reaction arises", text: 'Label it "This anger is a dream. This desire is a dream" and feel it loosen.' },
  { id: "habit:yoga-3", name: "Strengthening intention", when: "Before sleep", text: "Review the day, recognising each memory as a dream, then develop the strongest intention possible to know directly and vividly, while dreaming, that you are dreaming." },
  { id: "habit:yoga-4", name: "Cultivating memory and joyful effort", when: "On waking", text: "Review the night and record your dreams; rejoice if you were lucid, strengthen your determination if not; commit to consistency." },
] as const;

/**
 * Consecutive days a habit (or every id of a set) was done, counting back from today. Today not done yet does not
 * break it: the streak is then the run that ended yesterday.
 */
export function streak(ticks: readonly Tick[], ids: string | readonly string[], today: string): number {
  const need = typeof ids === "string" ? [ids] : ids;
  if (!need.length) return 0;
  const byDay = new Map<string, Set<string>>();
  for (const t of ticks) if (t.done) (byDay.get(t.date) ?? byDay.set(t.date, new Set()).get(t.date)!).add(t.item);
  const full = (d: string) => need.every((i) => byDay.get(d)?.has(i));
  let d = full(today) ? today : addDays(today, -1), n = 0;
  while (full(d)) { n++; d = addDays(d, -1); }
  return n;
}
export const habitStreak = (ticks: readonly Tick[], id: string, today: string) => streak(ticks, id, today);
/** The overall streak: days on which all four core habits were done. */
export const allDoneStreak = (ticks: readonly Tick[], today: string) => streak(ticks, CORE_HABIT_IDS, today);

// ---- Prospective-memory training (LaBerge, RESEARCH.md 1.6) ----
// Targets are restricted to this fixed list, as reminders restrict their labels: a typed target would be personal text
// and would need sealing, a plain id does not. The first four are LaBerge's own example day (Sunday).
export const PM_TARGETS = [
  { id: "pet", text: "next time I see a pet or animal" },
  { id: "mirror", text: "next time I look at my face in a mirror" },
  { id: "light", text: "next time I turn on a light" },
  { id: "flower", text: "next time I see a flower" },
  { id: "door", text: "next time I see a door" },
  { id: "clock", text: "next time I look at a clock" },
  { id: "stairs", text: "next time I use stairs" },
  { id: "window", text: "next time I look out of a window" },
  { id: "tap", text: "next time I turn on a tap" },
  { id: "car", text: "next time I see a car" },
  { id: "phone", text: "next time I pick up my phone" },
  { id: "cup", text: "next time I pick up a cup" },
] as const;
export const PM_LABERGE_DAY = ["pet", "mirror", "light", "flower"] as const;
export const PM_PER_DAY = 4;
export const pmTargetText = (id: string) => PM_TARGETS.find((t) => t.id === id)?.text;
/** LaBerge's exercise, step by step (EWLD ch. 3 as summarised in RESEARCH.md 1.6). */
export const PM_STEPS = [
  "Each morning read only that day's four target events and memorise them.",
  'During the day, when you notice the next occurrence of each target, perform a state test ("Am I dreaming?").',
  "At the end of the day record how many of the four targets you hit; a target noticed only on a later occurrence counts as a miss.",
  "Continue for at least a week; if you still miss most targets, continue with your own lists until you hit most of them.",
] as const;

export const pmSetId = (t: string) => `pm:${t}`;
export const pmHitId = (t: string) => `pm-hit:${t}`;
export const pmMissId = (t: string) => `pm-miss:${t}`;

export type PmState = "open" | "hit" | "miss";
export interface PmDay { date: string; targets: { id: string; state: PmState }[] }

/** One day's targets with their state, in the order set. `rows` are practice_log rows with done = true. */
export function pmDay(rows: readonly (Tick & { createdAt?: string })[], date: string): PmDay {
  const mine = rows.filter((r) => r.date === date && r.done);
  const set = mine.filter((r) => r.item.startsWith("pm:")).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const has = (i: string) => mine.some((r) => r.item === i);
  return {
    date,
    targets: set.map((r) => {
      const id = r.item.slice(3);
      return { id, state: has(pmHitId(id)) ? "hit" : has(pmMissId(id)) ? "miss" : "open" } as { id: string; state: PmState };
    }),
  };
}

export interface PmWeek { days: number; set: number; hit: number; miss: number; rate: number | null }
/**
 * The last 7 days (today included). On earlier days a target never logged counts as a miss, as in the exercise
 * ("record how many you hit at the end of the day"); today's unlogged ones are still open and left out.
 */
export function pmWeek(rows: readonly Tick[], today: string): PmWeek {
  let set = 0, hit = 0, miss = 0, days = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, -i), d = pmDay(rows, date);
    if (!d.targets.length) continue;
    days++;
    for (const t of d.targets) {
      set++;
      if (t.state === "hit") hit++;
      else if (t.state === "miss" || date < today) miss++;
    }
  }
  const counted = hit + miss;
  return { days, set, hit, miss, rate: counted ? hit / counted : null };
}

// ---- Dreamsign Awareness Scale (Lucidity Institute course, RESEARCH.md 1.8) ----
/** The scale's anchors, word for word from the course wording in RESEARCH.md. Index = rating 0-4. */
export const DSA_ANCHORS = [
  "No awareness: you only noticed the dreamsign was odd after you were awake.",
  "Odd: you noticed it was odd during the dream but did not try to explain it.",
  "Semilucid: you noticed it was odd and tried to explain it, but did not become lucid.",
  "Lucid: you noticed it was odd and realised therefore that you were dreaming.",
  "Post-lucid: you were already aware you were dreaming when the dreamsign occurred.",
] as const;
