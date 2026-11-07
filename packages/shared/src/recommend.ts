// Recommendations (PLAN.md §8.2, LDJ-27): a few rules over the person's own nights, dreams and reality checks, shown
// on Home and Train. Pure: the pages pass what they already loaded and today's date. Each one says why (the person's
// own numbers, in plain words) and cites RESEARCH.md (the citation sheet opens the source). The wording says "went
// with", never "caused" (these are the person's own nights, not an experiment), and never blames or shames.
// Nothing here ever recommends a substance (PLAN.md §8.2): the substances evidence is information in Learn, and the
// tests check every output for substance names.
// Naps are not nights (insights.ts): they stay out of night counts, but their dreams count as dreams.
import { addDays, loggedNights } from "./rates";
import { bucketOf, compareLucid, isWbtb, MIN_NIGHTS, type InsightDream, type InsightNight } from "./insights";

export interface Recommendation {
  /** Stable rule id: what a dismissal remembers. */
  id: RecommendationId;
  title: string;
  body: string;
  /** Why this shows now: the person's own numbers in plain words. */
  reason: string;
  /** RESEARCH.md reference ids, as Learn cites them ("B37"). */
  sources: string[];
  /** The one thing to do about it (a route in the app). */
  action?: { label: string; to: string };
  /** A page to read alongside (Learn's safety pages). */
  link?: { label: string; to: string };
}

export const RECOMMENDATION_IDS = ["wbtb-ease", "nightmares", "journal", "recall", "mild-wbtb", "wbtb-works", "false-awakenings", "checks"] as const;
export type RecommendationId = (typeof RECOMMENDATION_IDS)[number];

/** A dismissal: the rule id and the day it was dismissed. Plain and non-personal, so it syncs in the clear with settings. */
export interface Dismissal { id: string; on: string }
export const DISMISS_DAYS = 14;

export interface RecommendData {
  nights: InsightNight[];
  /** Every dream's plain facts (GET /dream-facts). */
  dreams: (InsightDream & { nightmare?: boolean; badDream?: boolean; falseAwakening?: boolean })[];
  /** The local day (YYYY-MM-DD) of each reality check. */
  checkDays: string[];
  reminders: { on: boolean; perDay?: number; habits?: number };
  dismissed?: Dismissal[];
}

// thresholds, named so the tests and the reasons read the same numbers
export const REC = {
  journalNights: 7, // fewer logged nights than this: keep journaling
  recallDays: 14, recallRate: 0.5, // recall under 50% of logged nights in the last 14 days: recall first
  noLucidDays: 21, // no lucid dream in 3 weeks (and no WBTB nights then): MILD + WBTB
  wbtbLead: 0.1, // WBTB nights' lucid rate at least 10 points above the others' (MIN_NIGHTS each): WBTB works
  easeWeeks: 8, easeWbtb: 3, easeRated: 3, easeDrop: 0.5, // sleep quality 0.5 lower in weeks with 3+ WBTB nights
  checkDays: 7, checksPerDay: 3, // under 3 reality checks a day over the last 7 days
  faDays: 30, faCount: 3, // 3 or more false awakenings in 30 days
  nmDays: 30, nmCount: 2, // 2 or more nightmares in 30 days
} as const;

/** Still hidden: dismissed less than DISMISS_DAYS days ago (it comes back on the 14th day after). */
export const isDismissed = (id: string, dismissed: Dismissal[] | undefined, today: string) =>
  !!dismissed?.some((d) => d.id === id && d.on <= today && addDays(d.on, DISMISS_DAYS) > today);

/** The dismissal list after dismissing `id` today: expired entries are dropped so the list stays short. */
export function dismiss(dismissed: Dismissal[] | undefined, id: string, today: string): Dismissal[] {
  return [...(dismissed ?? []).filter((d) => d.id !== id && isDismissed(d.id, [d], today)), { id, on: today }];
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;
const round1 = (x: number) => Math.round(x * 10) / 10;

/** At most `max` recommendations for today, most important first, dismissed ones left out. */
export function recommend(data: RecommendData, today: string, max = 3): Recommendation[] {
  const since = (days: number) => addDays(today, -(days - 1));
  const nights = loggedNights(data.nights).filter((x) => !x.nap && x.date <= today);
  const dateOf = new Map(data.nights.map((x) => [x.id, x.date]));
  const dreamsSince = (days: number) => { const from = since(days); return data.dreams.filter((d) => { const day = dateOf.get(d.nightId); return day != null && day >= from && day <= today; }); };
  const out: Recommendation[] = [];

  // sleep first: weeks with 3+ WBTB nights went with lower sleep quality
  const from8 = since(REC.easeWeeks * 7);
  const recent = nights.filter((x) => x.date >= from8);
  const wbtbPerWeek = new Map<string, number>();
  for (const x of recent) if (isWbtb(x)) wbtbPerWeek.set(bucketOf(x.date, "week"), (wbtbPerWeek.get(bucketOf(x.date, "week")) ?? 0) + 1);
  const busy = (x: InsightNight) => (wbtbPerWeek.get(bucketOf(x.date, "week")) ?? 0) >= REC.easeWbtb;
  const rated = recent.filter((x) => x.sleepQuality != null);
  const qBusy = rated.filter(busy).map((x) => x.sleepQuality!), qOther = rated.filter((x) => !busy(x)).map((x) => x.sleepQuality!);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ease = qBusy.length >= REC.easeRated && qOther.length >= REC.easeRated && avg(qOther) - avg(qBusy) >= REC.easeDrop - 1e-9;
  if (ease) out.push({
    id: "wbtb-ease", title: "Ease off WBTB: 1-2 nights a week",
    body: "Sleep comes first. Keep WBTB to one or two nights a week, on nights you can sleep in, and drop it for a while if you feel tired in the day.",
    reason: `In weeks with ${REC.easeWbtb} or more WBTB nights you rated your sleep ${round1(avg(qBusy))} out of 5 on average; in other weeks ${round1(avg(qOther))}.`,
    sources: ["B69", "B39", "B38"], link: { label: "Sleep first", to: "/learn/safety/sleep-first" },
  });

  // nightmares: only the ones that woke you count towards it. Bad dreams (upsetting, but you slept on) are more
  // common and go with well-being much less (Zadra and Donderi 2000, RESEARCH.md C18; C19 counts 431 bad dreams against 253 nightmares), so they never bring the
  // lesson up on their own; the reason names them when there were some, so the person sees the whole picture.
  const upset = dreamsSince(REC.nmDays);
  const nm = upset.filter((d) => d.nightmare).length;
  const bad = upset.filter((d) => !d.nightmare && d.badDream).length;
  if (nm >= REC.nmCount) out.push({
    id: "nightmares", title: "Nightmares: a lesson that may help",
    body: "Learning to become lucid has helped some people with recurring nightmares, though the studies are small. If they weigh on you, a therapist who knows imagery rehearsal is the best-tested help.",
    reason: `You noted ${n(nm, "nightmare")} that woke you${bad ? `, and ${n(bad, "bad dream")} that didn't,` : ""} in the last ${REC.nmDays} days.`,
    sources: ["B57", "B62", "B63", "B61", "C18"], action: { label: "Open the lesson", to: "/train?lesson=dream-control" }, link: { label: "When to stop", to: "/learn/safety/when-to-stop" },
  });

  // keep journaling, and recall before anything else
  const recallFrom = since(REC.recallDays);
  const last14 = nights.filter((x) => x.date >= recallFrom);
  const recalled = last14.filter((x) => (x.dreamCount ?? 0) > 0).length;
  const recall = last14.length ? recalled / last14.length : 0;
  const recallGood = nights.length >= REC.journalNights && last14.length > 0 && recall >= REC.recallRate;
  if (nights.length < REC.journalNights) out.push({
    id: "journal", title: "Keep journaling",
    body: "Write down whatever you remember each morning, even a fragment, or mark \"No recall\". Recall grows with a journal, and the rest of the training builds on it.",
    reason: nights.length ? `You have logged ${n(nights.length, "night")} so far; after ${REC.journalNights} the suggestions here can use your own numbers.` : `Nothing logged yet; after ${REC.journalNights} nights the suggestions here can use your own numbers.`,
    sources: ["B48", "C30"],
  });
  else if (last14.length && recall < REC.recallRate) out.push({
    id: "recall", title: "Work on recall first",
    body: "Before any technique, aim to remember a dream most mornings: lie still on waking, ask what you were just dreaming, and note even a fragment. Better recall went with more success with MILD in the studies.",
    reason: `You remembered a dream on ${recalled} of your ${n(last14.length, "logged night")} in the last ${REC.recallDays} days (${pct(recall)}).`,
    sources: ["B37", "B38", "B48"], action: { label: "Open the recall lesson", to: "/train?lesson=recall" },
  });

  // MILD + WBTB when recall is good, no lucid dream for 3 weeks, and no WBTB nights then
  const lucidFrom = since(REC.noLucidDays);
  const lucidLately = dreamsSince(REC.noLucidDays).some((d) => d.lucid) || nights.some((x) => x.date >= lucidFrom && ((x as InsightNight).lucidCount ?? 0) > 0);
  const wbtbLately = nights.some((x) => x.date >= lucidFrom && isWbtb(x));
  if (recallGood && !lucidLately && !wbtbLately) out.push({
    id: "mild-wbtb", title: "Try MILD with WBTB",
    body: "On your next free night, when you can sleep in, set an alarm about 5 hours after bedtime, stay up 30-60 minutes quietly, then do MILD as you fall back asleep. Aim to be asleep within about 10 minutes of finishing it: in the largest study, falling asleep that quickly went with lucid dreams on 18% of nights against 11%. Log how long it took in the night details. It is the best-supported combination in the studies.",
    reason: `Your recall is good (${pct(recall)} of nights in the last ${REC.recallDays} days), you have had no lucid dream in the last 3 weeks and no WBTB nights.`,
    sources: ["B37", "B38", "B39"], action: { label: "Plan WBTB", to: "/train?technique=wbtb" },
  });

  // WBTB works for you (not while sleep says ease off)
  const w = compareLucid(nights, data.dreams, { id: "wbtb", label: "WBTB", has: isWbtb, withNoun: { one: "WBTB night", many: "WBTB nights" }, withoutNoun: { one: "other night", many: "other nights" } });
  if (!ease && w.enough && w.with.rate! - w.without.rate! >= REC.wbtbLead - 1e-9) out.push({
    id: "wbtb-works", title: "WBTB works for you: plan 2-3 a week",
    body: "Lucid nights went with your WBTB nights more often than with other nights. Two or three a week, on nights you can sleep in, is what the sleep-first advice suggests.",
    reason: w.text, sources: ["B38", "B39", "B69"], action: { label: "Plan WBTB", to: "/train?technique=wbtb" },
  });

  // false awakenings
  const fa = dreamsSince(REC.faDays).filter((d) => d.falseAwakening).length;
  if (fa >= REC.faCount) out.push({
    id: "false-awakenings", title: "Check every time you wake",
    body: "Do a reality check each time you seem to wake up, before anything else: a false awakening is a good moment to become lucid. Make \"waking up\" one of your dream signs.",
    reason: `You noted ${n(fa, "false awakening")} in the last ${REC.faDays} days.`,
    sources: ["B8"], action: { label: "Open Signs", to: "/signs" }, link: { label: "False awakenings", to: "/learn/safety/false-awakenings-and-sleep-paralysis" },
  });

  // reality checks: the 7 days before today (today is not over yet)
  const checkFrom = addDays(today, -REC.checkDays);
  const checks = data.checkDays.filter((d) => d >= checkFrom && d < today).length;
  const perDay = checks / REC.checkDays;
  if (perDay < REC.checksPerDay) {
    const r = data.reminders;
    out.push({
      id: "checks", title: r.on ? "More reality checks in the day" : "Turn on reality check reminders",
      body: r.on
        ? "Raise the number of reminders, or add habit moments (walking through a door, after a meal) so checking becomes automatic. Checks on their own do little; the habit is what carries into dreams."
        : "Reminders spread checks over your day so you don't have to remember. Checks on their own do little; the habit is what carries into dreams.",
      reason: `You did ${n(checks, "reality check")} in the last ${REC.checkDays} days, about ${round1(perDay)} a day${r.on && r.perDay ? `, with ${n(r.perDay, "reminder")} a day` : ""}${r.on ? "" : ", and reminders are off"}.`,
      sources: ["B36", "B37"], action: { label: r.on ? "Reminder settings" : "Turn on reminders", to: "/settings/notifications" },
    });
  }

  return out.filter((r) => !isDismissed(r.id, data.dismissed, today)).slice(0, max);
}
