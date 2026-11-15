// Recommendations (PLAN.md §8.2, LDJ-27): a few rules over the person's own nights, dreams and reality checks, shown
// on Home and Train. Pure: the pages pass what they already loaded and today's date. Each one says why (the person's
// own numbers, in plain words) and cites RESEARCH.md (the citation sheet opens the source). The wording says "went
// with", never "caused" (these are the person's own nights, not an experiment), and never blames or shames.
// Nothing here ever recommends a substance (PLAN.md §8.2): the substances evidence is information in Learn, and the
// tests check every output for substance names.
// Naps are not nights (insights.ts): they stay out of night counts, but their dreams count as dreams.
import { addDays, loggedNights, minutesToSleep } from "./rates";
import { bucketOf, compareLucid, isWbtb, MIN_NIGHTS, type InsightDream, type InsightNight } from "./insights";
import type { SetupExperience, SetupGoal } from "./settings";
import type { Milestones } from "./milestones";

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

export const RECOMMENDATION_IDS = ["safety", "wbtb-ease", "nightmares", "journal", "recall", "mild-wbtb", "wbtb-works", "false-awakenings", "checks", "first-lucid", "dry-spell", "stabilise", "mild-sleep", "try-ssild"] as const;
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
  /** The safety check's outcome (settings.safety.sleepFirst, LDJ-116): nothing suggests WBTB, the CAT alarm or naps. */
  sleepFirst?: boolean;
  /** The first-run setup's answer to "how much lucid dreaming have you done" (settings.setup.experience, LDJ-183):
   *  "some" and "regular" have had lucid dreams before the journal, so a dry spell can be one even with none logged,
   *  the journal is no news to a regular, and a logged lucid dream is not their first. */
  experience?: SetupExperience;
  /** The first-run setup's goal (settings.setup.goal, LDJ-216): the cards that serve it come first. It only reorders:
   *  nothing shows that the person's own numbers did not bring up, and nothing is hidden. */
  goal?: SetupGoal;
  /** Milestone moments already shown (settings.milestones, LDJ-117): after the first lucid dream's own moment, which
   *  already said well done and the three steps, the card only points on to the lesson. */
  milestones?: Milestones;
  /** A safety page the check asked to show once (kept on the device; cleared when read or put away). */
  safetyPage?: SafetyPage;
}

/** The Learn safety pages the safety check can point to (packages/knowledge/content/safety). */
export type SafetyPage = "who-should-be-careful" | "sleep-first";
const SAFETY_RECS: Record<SafetyPage, Omit<Recommendation, "id" | "reason">> = {
  "who-should-be-careful": {
    title: "Worth reading before you start",
    body: "A short page on who should go slowly with lucid dreaming, or talk it over with a doctor first. Until you change your answers, Somnium leaves the techniques that cut into sleep out of its suggestions.",
    sources: ["B69", "B70", "B71", "B72"], link: { label: "Who should be careful", to: "/learn/safety/who-should-be-careful" },
  },
  "sleep-first": {
    title: "Sleep comes first",
    body: "Lucid dreaming needs good sleep, and the techniques that wake you in the night cut into it. Somnium leaves wake back to bed, the CAT alarm and naps out of its suggestions for now. If you find you are losing sleep, let it go for a few days.",
    sources: ["B69", "B70", "D1"], link: { label: "Sleep first", to: "/learn/safety/sleep-first" },
  },
};

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
  drySpellDays: 28, // had lucid dreams before, none in the last 4 weeks while still journaling (journalNights of them)
  briefDays: 60, briefMin: 3, // over half of 3+ rated lucid dreams in 60 days at level 1 ("a brief flash, lost at once")
  firstLucidDays: 14, // the one and only lucid dream, in the last 2 weeks
  mildSleepDays: 30, mildSleepNights: 3, mildSleepMinutes: 20, // over half of 3+ MILD nights took more than 20 minutes to sleep
  ssildDays: 42, ssildNights: 8, // 8+ MILD + WBTB nights in 6 weeks since the last lucid dream, and no SSILD then
} as const;

/** Still hidden: dismissed less than DISMISS_DAYS days ago (it comes back on the 14th day after). */
export const isDismissed = (id: string, dismissed: Dismissal[] | undefined, today: string) =>
  !!dismissed?.some((d) => d.id === id && d.on <= today && addDays(d.on, DISMISS_DAYS) > today);

/** The dismissal list after dismissing `id` today: expired entries are dropped so the list stays short. */
export function dismiss(dismissed: Dismissal[] | undefined, id: string, today: string): Dismissal[] {
  return [...(dismissed ?? []).filter((d) => d.id !== id && isDismissed(d.id, [d], today)), { id, on: today }];
}

// The cards that serve each setup goal, in the order they come up (LDJ-216). Each card keeps its own sources; the
// mapping follows them: recall is what the rest builds on and predicts success (B38, B48, C30); a first lucid dream
// comes from MILD after WBTB with recall in place, falling asleep quickly after it, and checks made a habit (B37, B38,
// B39, B36), and once it comes, the card about it leads (D1, D5); more often is the same combination kept up, then SSILD after the alarm (B38, B35), and rest in a dry
// spell (D1, D5, D24); longer and clearer is stabilising, a skill of its own (D1 ch. 6, D5 Unit 5, D8).
export const GOAL_FIRST: Record<Exclude<SetupGoal, "">, RecommendationId[]> = {
  recall: ["recall", "journal"],
  first: ["first-lucid", "mild-wbtb", "mild-sleep", "checks", "recall", "journal"],
  often: ["mild-wbtb", "wbtb-works", "try-ssild", "dry-spell", "mild-sleep"],
  longer: ["stabilise", "first-lucid"],
};
// Safety comes before any goal: the safety check's page, easing off WBTB when sleep suffers, and the nightmares card
// keep their place at the top (sleep first, B69, B70).
const PINNED: RecommendationId[] = ["safety", "wbtb-ease", "nightmares"];

/** The cards in goal order: pinned safety cards first as they were, then the goal's cards, then the rest, each group
 *  in its own order (a stable sort). */
export function byGoal(recs: Recommendation[], goal: SetupGoal | undefined): Recommendation[] {
  const prefer = goal ? GOAL_FIRST[goal] : [];
  const rank = (r: Recommendation) => (PINNED.includes(r.id) ? -1 : prefer.includes(r.id) ? prefer.indexOf(r.id) : prefer.length);
  return recs.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map((x) => x.r);
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;
const round1 = (x: number) => Math.round(x * 10) / 10;
const daysAgo = (k: number) => (k <= 0 ? "today" : k === 1 ? "yesterday" : `${k} days ago`);

/** At most `max` recommendations for today, most important first, dismissed ones left out. */
export function recommend(data: RecommendData, today: string, max = 3): Recommendation[] {
  const since = (days: number) => addDays(today, -(days - 1));
  const nights = loggedNights(data.nights).filter((x) => !x.nap && x.date <= today);
  const dateOf = new Map(data.nights.map((x) => [x.id, x.date]));
  const dreamsSince = (days: number) => { const from = since(days); return data.dreams.filter((d) => { const day = dateOf.get(d.nightId); return day != null && day >= from && day <= today; }); };
  const out: Recommendation[] = [];
  // lucid dreams per day, naps included: the dream list where it has them, else the night's own count (GET /nights)
  const lucidOn = new Map<string, number>();
  const lucidByNight = new Map<string, number>();
  for (const d of data.dreams) if (d.lucid) lucidByNight.set(d.nightId, (lucidByNight.get(d.nightId) ?? 0) + 1);
  for (const x of loggedNights(data.nights)) {
    const k = Math.max(lucidByNight.get(x.id) ?? 0, x.lucidCount ?? 0);
    if (k && x.date <= today) lucidOn.set(x.date, (lucidOn.get(x.date) ?? 0) + k);
  }
  const lucidDays = [...lucidOn.keys()].sort();
  const lucidTotal = [...lucidOn.values()].reduce((a, b) => a + b, 0);
  const lastLucid = lucidDays.at(-1);
  const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  const experienced = data.experience === "some" || data.experience === "regular";

  // the safety check's page, once, ahead of everything (it is put away for good, not for 14 days: ForYouCard)
  if (data.safetyPage) out.push({ id: "safety", ...SAFETY_RECS[data.safetyPage], reason: "You said yes to a question in the safety check." });

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
    sources: ["B57", "B62", "B63", "B61", "C18"], action: { label: "Open the lesson", to: "/train/lesson/dream-control" }, link: { label: "When to stop", to: "/learn/safety/when-to-stop" },
  });

  // the first lucid dream: well done, and the next lesson is staying in it. Novices "often wake up the moment they
  // become lucid" (LaBerge, RESEARCH.md D1 ch. 6; the Course, D5 Unit 5). Not for people who told the setup they have
  // had lucid dreams before: the first one logged here is not their first.
  if (!experienced && lucidTotal === 1 && lastLucid! >= since(REC.firstLucidDays)) out.push({
    id: "first-lucid", ...(data.milestones?.["first-lucid"] ? {
      title: "Staying in your next lucid dream",
      body: "The lesson goes through it step by step, with a short practice to run before sleep so the steps come back to you in the dream.",
    } : {
      title: "Your first lucid dream",
      body: "Well done. The next step is staying in it: new lucid dreamers often wake up the moment they realise. The lesson shows how: stay calm, take in the dream with your senses, and spin if it starts to fade.",
    }),
    reason: `You logged your first lucid dream ${daysAgo(daysBetween(lastLucid!, today))}.`,
    sources: ["D1", "D5"], action: { label: "Open the lesson", to: "/train/lesson/stabilise" },
  });

  // keep journaling, and recall before anything else
  const recallFrom = since(REC.recallDays);
  const last14 = nights.filter((x) => x.date >= recallFrom);
  const recalled = last14.filter((x) => (x.dreamCount ?? 0) > 0).length;
  const recall = last14.length ? recalled / last14.length : 0;
  const recallGood = nights.length >= REC.journalNights && last14.length > 0 && recall >= REC.recallRate;
  // someone who told the setup they have lucid dreams regularly already knows the journal; their own numbers still
  // bring up recall below when it is low (recall predicts success, B38)
  if (nights.length < REC.journalNights && data.experience !== "regular") out.push({
    id: "journal", title: "Keep journaling",
    body: "Write down whatever you remember each morning, even a fragment, or mark \"No recall\". Recall grows with a journal, and the rest of the training builds on it.",
    reason: nights.length ? `You have logged ${n(nights.length, "night")} so far; after ${REC.journalNights} the suggestions here can use your own numbers.` : `Nothing logged yet; after ${REC.journalNights} nights the suggestions here can use your own numbers.`,
    sources: ["B48", "C30"],
  });
  else if (nights.length >= REC.journalNights && last14.length && recall < REC.recallRate) out.push({
    id: "recall", title: "Work on recall first",
    body: "Before any technique, aim to remember a dream most mornings: lie still on waking, ask what you were just dreaming, and note even a fragment. Better recall went with more success with MILD in the studies.",
    reason: `You remembered a dream on ${recalled} of your ${n(last14.length, "logged night")} in the last ${REC.recallDays} days (${pct(recall)}).`,
    sources: ["B37", "B38", "B48"], action: { label: "Open the recall lesson", to: "/train/lesson/recall" },
  });

  // a dry spell: lucid dreams before (logged, or from the setup's answer), none in the last 4 weeks of journaling.
  // The literature treats dry spells as expected; LaBerge's remedies are rest, renewed motivation and a lower-effort
  // method such as autosuggestion (RESEARCH.md Part D §7: D1 ch. 1 and 3, D5 Unit 3); Love refreshes the first steps
  // every few months (D24); recall predicts success (B38). It replaces MILD + WBTB below: more effort is the wrong
  // advice for someone who may be trying too hard.
  const dryFrom = since(REC.drySpellDays);
  const firstLogged = nights.length ? nights.reduce((a, x) => (x.date < a ? x.date : a), nights[0]!.date) : null;
  const loggedDry = nights.filter((x) => x.date >= dryFrom).length;
  const lucidBefore = lucidDays.some((d) => d < dryFrom);
  const dry = !lucidDays.some((d) => d >= dryFrom) && loggedDry >= REC.journalNights && (lucidBefore || (experienced && firstLogged! < dryFrom));
  if (dry) out.push({
    id: "dry-spell", title: "A dry spell: rest, then try something easier",
    body: "Dry spells are normal and they pass. Let lucid dreaming go for a few days and just sleep. Then come back with a lower-effort method, such as relaxing in bed and gently suggesting to yourself that you will have a lucid dream soon, without forcing it, and remind yourself why you wanted lucid dreams in the first place. Keep the journal going, and go back over the first steps: recall is what the rest builds on.",
    reason: lucidBefore
      ? `Your last lucid dream was ${daysAgo(daysBetween(lastLucid!, today))}, and you have logged ${n(loggedDry, "night")} in the last 4 weeks.`
      : `You said in setup that you have had lucid dreams, and none are logged in the last 4 weeks (${n(loggedDry, "night")} logged).`,
    sources: ["D1", "D5", "D24", "B38"], action: { label: "Open the lesson", to: "/train/lesson/troubleshooting" },
    link: { label: "Common mistakes and dry spells", to: "/learn/basics/common-mistakes-and-dry-spells" },
  });

  // MILD + WBTB when recall is good, no lucid dream for 3 weeks, and no WBTB nights then; never after the safety check
  // said sleep first (sleep-interrupting methods can harm sleep, B69, B70)
  const lucidFrom = since(REC.noLucidDays);
  const lucidLately = dreamsSince(REC.noLucidDays).some((d) => d.lucid) || nights.some((x) => x.date >= lucidFrom && ((x as InsightNight).lucidCount ?? 0) > 0);
  const wbtbLately = nights.some((x) => x.date >= lucidFrom && isWbtb(x));
  if (recallGood && !lucidLately && !wbtbLately && !data.sleepFirst && !dry) out.push({
    id: "mild-wbtb", title: "Try MILD with WBTB",
    body: "On your next free night, when you can sleep in, set an alarm about 5 hours after bedtime, stay up 30-60 minutes quietly, then do MILD as you fall back asleep. Aim to be asleep within about 10 minutes of finishing it: in the largest study, falling asleep that quickly went with lucid dreams on 18% of nights against 11%. Log how long it took in the night details. It is the best-supported combination in the studies.",
    reason: `Your recall is good (${pct(recall)} of nights in the last ${REC.recallDays} days), you have had no lucid dream in the last 3 weeks and no WBTB nights.`,
    sources: ["B37", "B38", "B39"], action: { label: "Plan WBTB", to: "/train/technique/wbtb" },
  });

  // lucid but lost at once: over half of the rated lucid dreams lately at level 1 ("A brief flash, lost at once",
  // journal.ts LUCIDITY_ANCHORS). Stabilising is a skill: stay calm, engage the senses, spin when vision fades
  // (D1 ch. 6, D5 Unit 5), keep the eyes moving because a fixed gaze ends the dream (Tholey, D8); LaBerge lost lucidity in 18% of his lucid dreams in his first year, under 1% after (D1 ch. 6).
  // Not alongside the first lucid dream's card, which opens the same lesson, nor in a dry spell: those brief lucid
  // dreams were over 4 weeks ago, and the dry spell's card already says to rest first.
  const briefFrom = since(REC.briefDays);
  const ratedLucid = data.dreams.filter((d) => { const day = dateOf.get(d.nightId); return d.lucid && (d.lucidityLevel ?? 0) > 0 && day != null && day >= briefFrom && day <= today; });
  const brief = ratedLucid.filter((d) => Math.round(d.lucidityLevel!) === 1).length;
  if (ratedLucid.length >= REC.briefMin && brief * 2 > ratedLucid.length && !out.some((r) => r.id === "first-lucid") && !dry) out.push({
    id: "stabilise", title: "Staying lucid for longer",
    body: "Becoming lucid is the hard part, and you are doing it. Staying is a skill of its own: keep calm, touch things and rub your hands, look at details while keeping your eyes moving, and spin like a top if the dream starts to fade. LaBerge lost his lucidity in nearly 1 in 5 lucid dreams in his first year, and almost never after that.",
    reason: `${brief} of your ${n(ratedLucid.length, "rated lucid dream")} in the last ${REC.briefDays} days were a brief flash, lost at once.`,
    sources: ["D1", "D5", "D8"], action: { label: "Open the lesson", to: "/train/lesson/stabilise" },
  });

  // slow to sleep after MILD: falling asleep within 10 minutes of finishing went with more lucid nights (18% against
  // 11%, ILDIS, B38; the 5-minute finding in B37). Do it lying down in the dark (the NALDIS instructions, B37); ILDIS
  // told people who could not get back to sleep to keep the lights off, use a quieter alarm and stay up for less time
  // (D12); after 20 minutes, let go and keep the intention as the last thought (the Course, D5 Unit 3).
  const mildFrom = since(REC.mildSleepDays);
  const mildTimed = nights.filter((x) => x.date >= mildFrom && x.techniquesDone?.includes("mild") && minutesToSleep(x) != null);
  const slow = mildTimed.filter((x) => minutesToSleep(x)! > REC.mildSleepMinutes).length;
  if (mildTimed.length >= REC.mildSleepNights && slow * 2 > mildTimed.length) out.push({
    id: "mild-sleep", title: "Falling asleep sooner after MILD",
    body: "Do MILD lying down, with the lights off, ready to sleep. If you got up for it, keep the time up short and quiet, and use a softer alarm. If you are still awake after about 20 minutes, stop trying: let the intention be your last thought and drift off. In the largest study, falling asleep within 10 minutes of finishing went with lucid dreams on 18% of nights against 11%.",
    reason: `On ${slow} of your ${n(mildTimed.length, "MILD night")} in the last ${REC.mildSleepDays} days it took you more than ${REC.mildSleepMinutes} minutes to fall asleep.`,
    sources: ["B38", "B37", "D12", "D5"], action: { label: "Open MILD", to: "/train/technique/mild" },
  });

  // MILD + WBTB for a while and no lucid dream: SSILD after the same alarm did as well as MILD in ILDIS (16.9% of nights,
  // B38), though it rests on that one study (B35); its author's advice is to expect nothing (D19). It cuts into sleep
  // like WBTB, so never after the safety check said sleep first or while sleep says ease off, nor in a dry spell, whose
  // card says to rest and try something lower-effort, not another technique after the alarm.
  const ssildFrom = since(REC.ssildDays);
  const triedFrom = lastLucid && lastLucid >= ssildFrom ? addDays(lastLucid, 1) : ssildFrom;
  const tried = nights.filter((x) => x.date >= triedFrom && isWbtb(x) && x.techniquesDone?.includes("mild")).length;
  const ssildLately = nights.some((x) => x.date >= triedFrom && x.techniquesDone?.includes("ssild"));
  if (tried >= REC.ssildNights && !ssildLately && !ease && !data.sleepFirst && !dry) out.push({
    id: "try-ssild", title: "Try SSILD after WBTB",
    body: "After the same WBTB alarm, try SSILD instead of MILD for a while: lie down, close your eyes and move your attention through sight, sound and touch in a few quick rounds, then a few slow ones, then let yourself sleep. Expect nothing. In the largest study it did as well as MILD, though that is the only study so far.",
    reason: `You have done MILD with WBTB on ${n(tried, "night")} in the last ${REC.ssildDays / 7} weeks without a lucid dream${lastLucid ? " since your last one" : ""}.`,
    sources: ["B38", "B35", "D19"], action: { label: "Open SSILD", to: "/train/technique/ssild" },
  });

  // WBTB works for you (not while sleep says ease off)
  const w = compareLucid(nights, data.dreams, { id: "wbtb", label: "WBTB", has: isWbtb, withNoun: { one: "WBTB night", many: "WBTB nights" }, withoutNoun: { one: "other night", many: "other nights" } });
  if (!ease && !data.sleepFirst && w.enough && w.with.rate! - w.without.rate! >= REC.wbtbLead - 1e-9) out.push({
    id: "wbtb-works", title: "WBTB works for you: plan 2-3 a week",
    body: "Lucid nights went with your WBTB nights more often than with other nights. Two or three a week, on nights you can sleep in, is what the sleep-first advice suggests.",
    reason: w.text, sources: ["B38", "B39", "B69"], action: { label: "Plan WBTB", to: "/train/technique/wbtb" },
  });

  // false awakenings
  const fa = dreamsSince(REC.faDays).filter((d) => d.falseAwakening).length;
  if (fa >= REC.faCount) out.push({
    id: "false-awakenings", title: "Check every time you wake",
    body: "Do a reality check each time you seem to wake up, before anything else: a false awakening is a good moment to become lucid. Make \"waking up\" one of your dream signs.",
    reason: `You noted ${n(fa, "false awakening")} in the last ${REC.faDays} days.`,
    sources: ["B8"], action: { label: "Open Dream signs", to: "/signs" }, link: { label: "False awakenings", to: "/learn/safety/false-awakenings-and-sleep-paralysis" },
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
      sources: ["B36", "B37"], action: { label: r.on ? "Reminder settings" : "Turn on reminders", to: "/settings/reminders" },
    });
  }

  return byGoal(out.filter((r) => !isDismissed(r.id, data.dismissed, today)), data.goal).slice(0, max);
}
