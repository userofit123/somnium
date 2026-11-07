// Pure timing for Train's guided modes (PLAN.md §6.4, §9; LDJ-25): the WBTB alarm from bedtime and sleep cycles, the
// SSILD cycle schedule and the WILD timer's phases. The screens are apps/web/src/components/train/guided/.
// Every number here comes from RESEARCH.md (references as the Learn articles cite them, Part B = B, Part D = D).

/** A sleep cycle's length in minutes: 90 by default, adjustable (PLAN.md §9). */
export const CYCLE_MIN = 90;
export const CYCLE_RANGE = { min: 60, max: 120, step: 5 } as const;
/** The cycles the planner offers: 3, 4 and 5 (4.5, 6 and 7.5 h at 90 min). */
export const WBTB_CYCLES = [3, 4, 5] as const;
/** About 6 h of sleep before waking: Erlacher and Stumbrys 2020 woke people from REM after about 6 h [D13]. */
export const WBTB_DEFAULT_CYCLES = 4;
/** 4.5 h or less is too early: the follow-up that woke people at 4.5 h found "the earlier sleep interruption seems to
 *  reduce the lucid dream induction rate" (Erlacher et al. 2022) [D14]. 4.5 h itself is the tested time, so it warns. */
export const WBTB_TOO_EARLY_MIN = 270;
/** Under 5 h is still early: RESEARCH.md §3.4 recommends WBTB after roughly 5-6 h of sleep [B39][B40]. */
export const WBTB_EARLY_MIN = 300;
/** Minutes up. RESEARCH.md §3.4 and safety rule 3 recommend 30-60 minutes of quiet dream work [B39]; 60 beat 30 in
 *  the laboratory (Erlacher and Stumbrys 2020) [D13]. 10 is offered as the short choice, said plainly to be less
 *  effective: the LaBerge, Phillips and Levitan nap studies found 10 minutes awake less effective [B39]. */
export const WBTB_AWAKE = [10, 30, 60] as const;
export const WBTB_AWAKE_DEFAULT = 30;

const pad = (n: number) => String(n).padStart(2, "0");
/** "HH:MM" (or "HH:MM:SS") to minutes after midnight; null when it is not a time. */
export function hmToMin(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(s ?? "");
  if (!m) return null;
  const h = +m[1]!, mi = +m[2]!;
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
export const minToHm = (min: number) => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };

/**
 * The local moment of a bedtime for the night filed under `morning` (YYYY-MM-DD, the date the night ends on): a
 * bedtime from noon on is the evening before, one before noon is after midnight, on the morning's own date.
 */
export function bedtimeAt(morning: string, bedtime: string): Date {
  const [y, mo, d] = morning.split("-").map(Number) as [number, number, number];
  const min = hmToMin(bedtime) ?? 23 * 60;
  return new Date(y, mo - 1, d - (min >= 12 * 60 ? 1 : 0), Math.floor(min / 60), min % 60);
}

export type WbtbTiming = "too-early" | "early" | "ok";
/** How a night's sleep before the alarm compares with the evidence (WBTB_TOO_EARLY_MIN, WBTB_EARLY_MIN). */
export const wbtbTiming = (sleepMin: number): WbtbTiming => (sleepMin <= WBTB_TOO_EARLY_MIN ? "too-early" : sleepMin < WBTB_EARLY_MIN ? "early" : "ok");

export interface WbtbOption {
  cycles: number;
  sleepMin: number;
  /** the alarm, a local moment */
  at: Date;
  /** "HH:MM" */
  wake: string;
  /** the alarm is on the day after the bedtime (it crossed midnight) */
  nextDay: boolean;
  /** "too-early": 4.5 h of sleep or less [D14]; "early": under 5 h (5-6 h recommended, RESEARCH.md §3.4); else "ok" */
  timing: WbtbTiming;
}

/** One WBTB alarm: bedtime plus whole sleep cycles. */
export function wbtbOption(bed: Date, cycles: number, cycleMin = CYCLE_MIN): WbtbOption {
  const sleepMin = Math.max(1, Math.round(cycles)) * cycleMin;
  const at = new Date(bed.getFullYear(), bed.getMonth(), bed.getDate(), bed.getHours(), bed.getMinutes() + sleepMin);
  const nextDay = at.getDate() !== bed.getDate() || at.getMonth() !== bed.getMonth() || at.getFullYear() !== bed.getFullYear();
  return { cycles, sleepMin, at, wake: `${pad(at.getHours())}:${pad(at.getMinutes())}`, nextDay, timing: wbtbTiming(sleepMin) };
}

/** The planner's choices: 3, 4 and 5 cycles after bedtime (plus `extra` cycle counts, e.g. a chosen 2). */
export function wbtbOptions(bed: Date, cycleMin = CYCLE_MIN, extra: readonly number[] = []): WbtbOption[] {
  const n = [...new Set([...extra, ...WBTB_CYCLES])].sort((a, b) => a - b);
  return n.map((c) => wbtbOption(bed, c, cycleMin));
}

/** A saved cycle length held to the allowed range (60-120 min), 90 when missing. */
export const cycleOf = (v: unknown): number => { const n = Math.round(Number(v)); return n >= CYCLE_RANGE.min && n <= CYCLE_RANGE.max ? n : CYCLE_MIN; };

/** The cycle count closest to about 6 h of sleep for a cycle length (4 at 90 min) [D13]. */
export const defaultCycles = (cycleMin = CYCLE_MIN) => Math.max(1, Math.round(360 / cycleMin));

/** "6 h", "4 h 30 min", "45 min". */
export function durationText(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

// ----- SSILD (Cosmic Iron's tutorial 2.0 [D19]; ILDIS's simplified version [D12]) -----
export type Sense = "sight" | "sound" | "body";
export const SENSES: readonly Sense[] = ["sight", "sound", "body"];
/** Fast cycles: 4-6, "only a few seconds per step" [D19] (ILDIS: four, 2-3 s per step [D12]).
 *  Slow cycles: 3-4, "at least about 30 seconds per step" [D19] (ILDIS: at least four, about 20 s [D12]). */
export const SSILD = {
  fast: { min: 4, max: 6, default: 4, stepSec: 3 },
  slow: { min: 3, max: 6, default: 4, stepSec: 30 },
} as const;

export interface SsildStep { phase: "fast" | "slow"; cycle: number; sense: Sense; start: number; end: number }
export interface SsildPlan { steps: SsildStep[]; total: number }

/** The whole SSILD sequence in seconds: the fast cycles, then the slow ones, each sight, sound, body. */
export function ssildSchedule(fast: number = SSILD.fast.default, slow: number = SSILD.slow.default, fastSec: number = SSILD.fast.stepSec, slowSec: number = SSILD.slow.stepSec): SsildPlan {
  const steps: SsildStep[] = [];
  let t = 0;
  for (const [phase, n, sec] of [["fast", fast, fastSec], ["slow", slow, slowSec]] as const) {
    for (let c = 1; c <= n; c++) for (const sense of SENSES) { steps.push({ phase, cycle: c, sense, start: t, end: t + sec }); t += sec; }
  }
  return { steps, total: t };
}

/** The step at `sec` seconds in, or null once the cycles are done. */
export const ssildAt = (plan: SsildPlan, sec: number): SsildStep | null => (sec < 0 ? plan.steps[0] ?? null : plan.steps.find((s) => sec >= s.start && sec < s.end) ?? null);

// ----- WILD: a soft timer -----
/** Session lengths offered (minutes). The Course in Lucid Dreaming's advice for MILD applies here too: after about 20
 *  minutes without sleep, let go and just rest [D5]. */
export const WILD_MINUTES = [10, 15, 20] as const;
export type WildPhase = "relax" | "images" | "focus" | "done";
/** The guide's pacing (the app's own split, not from a study): relax the body for the first fifth (at least 2 min),
 *  then watch the images, and in the last third keep a light focus and let yourself be drawn in [D1]. */
export function wildPhase(sec: number, totalSec: number): WildPhase {
  if (sec >= totalSec) return "done";
  if (sec < Math.max(120, totalSec / 5)) return "relax";
  return sec < (totalSec * 2) / 3 ? "images" : "focus";
}

/** "4:05" for a count of seconds (minutes can pass 59). */
export const clockText = (sec: number) => { const s = Math.max(0, Math.floor(sec)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
