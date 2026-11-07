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

// ----- WBTB modes (LDJ-49): short, long and the LaBerge nap -----
// Each mode is a studied protocol: how long to sleep first, how long to stay up and what comes next. RESEARCH.md
// Part D §3.1 and §3.3 (references as Part D numbers them: D4 LaBerge, Phillips and Levitan 1994; D5 the Course;
// D11/D12 Aspy 2017/2020; D13 Erlacher and Stumbrys 2020).
export const WBTB_MODES = ["short", "long", "nap"] as const;
export type WbtbMode = (typeof WBTB_MODES)[number];
/** What a night can log as the WBTB mode used (nights.wbtb_mode); CAT mornings log "cat". */
export const WBTB_MODE_LOG = [...WBTB_MODES, "cat"] as const;
export type WbtbModeLog = (typeof WBTB_MODE_LOG)[number];

export interface WbtbModeDef {
  id: WbtbMode;
  label: string;
  /** minutes of sleep before the alarm */
  sleepMin: number;
  /** the minutes-up choices, and the default */
  awake: readonly number[];
  awakeDefault: number;
  /** what to do once back in bed */
  next: "mild" | "nap";
  /** the nap's length in minutes (nap mode only) */
  napMin?: number;
  /** the evidence line, Markdown inline with its sources */
  ev: string;
}

export const WBTB_MODE_DEFS: Record<WbtbMode, WbtbModeDef> = {
  // Aspy: alarm at 5 hours after bedtime; the MILD groups stayed up only as long as the technique took, so "a 5-10
  // minute WBTB is enough for MILD" [D11][D12].
  short: {
    id: "short", label: "Short", sleepMin: 300, awake: [5, 10], awakeDefault: 10, next: "mild",
    ev: "Aspy's studies: alarm 5 hours after bedtime, up only as long as MILD takes (5-10 minutes), then back to sleep. Lucid dreams on 17.4% of nights in the technique week, from 9.4% the week before [D11][D12].",
  },
  // Erlacher and Stumbrys 2020: woken from REM after at least 5 h 40 min (about 6 h), 60 minutes of dream work and
  // MILD: 54.5% and 53.3% lucid in two cohorts (30 minutes: 35.7%) [D13].
  long: {
    id: "long", label: "Long", sleepMin: 360, awake: [30, 60], awakeDefault: 60, next: "mild",
    ev: "Erlacher and Stumbrys 2020: about 6 hours of sleep, then 60 minutes of dream work and MILD. 53% had a lucid dream in a single night (30 minutes up: 36%) [D13].",
  },
  // LaBerge, Phillips and Levitan 1994: up early (the nap protocols wake 60-90 minutes before the normal rising time,
  // [D4][D5]), 60 minutes awake reading about lucid dreaming, then a 90-minute morning nap: 27% of nap dreams lucid
  // versus 1.3% of night dreams; 60 minutes up gave five times as many lucid dreamers as 10 [D4]. The Course: a 90-120
  // minute alarm for the nap [D5].
  nap: {
    id: "nap", label: "LaBerge nap", sleepMin: 360, awake: [60], awakeDefault: 60, next: "nap", napMin: 90,
    ev: "LaBerge, Phillips and Levitan 1994: wake early (about 6 hours in), stay up 60 minutes reading about lucid dreaming, then a 90-minute nap. 27% of nap dreams were lucid, against 1.3% of night dreams [D4].",
  },
};
export const isWbtbMode = (v: unknown): v is WbtbMode => typeof v === "string" && (WBTB_MODES as readonly string[]).includes(v);

/** The alarm `sleepMin` minutes after bedtime (any length, not only whole cycles). */
export function wbtbAfter(bed: Date, sleepMin: number, cycleMin = CYCLE_MIN): WbtbOption {
  const m = Math.max(1, Math.round(sleepMin));
  const at = new Date(bed.getFullYear(), bed.getMonth(), bed.getDate(), bed.getHours(), bed.getMinutes() + m);
  const nextDay = at.getDate() !== bed.getDate() || at.getMonth() !== bed.getMonth() || at.getFullYear() !== bed.getFullYear();
  return { cycles: m / cycleMin, sleepMin: m, at, wake: `${pad(at.getHours())}:${pad(at.getMinutes())}`, nextDay, timing: wbtbTiming(m) };
}

export interface WbtbModePlan {
  mode: WbtbMode;
  /** the alarm */
  alarm: WbtbOption;
  /** back in bed (alarm + minutes up) */
  backAt: Date;
  /** the nap's end, nap mode only */
  napEnd: Date | null;
}
/** A mode's times from bedtime: the alarm, back to bed and (nap) the nap's end. `sleepMin` and `awakeMin` override. */
export function wbtbModePlan(bed: Date, mode: WbtbMode, opts: { sleepMin?: number; awakeMin?: number; cycleMin?: number } = {}): WbtbModePlan {
  const d = WBTB_MODE_DEFS[mode];
  const alarm = wbtbAfter(bed, opts.sleepMin ?? d.sleepMin, opts.cycleMin);
  const backAt = new Date(alarm.at.getTime() + (opts.awakeMin ?? d.awakeDefault) * 60_000);
  return { mode, alarm, backAt, napEnd: d.napMin ? new Date(backAt.getTime() + d.napMin * 60_000) : null };
}

// ----- CAT, the Cycle Adjustment Technique (Daniel Love [D24]; anecdotal evidence) -----
/** Stage 1: 7 days of waking 90 minutes before the normal wake time and staying up 90 minutes, reality testing every
 *  2-5 minutes. Stage 2: alternate Day A (alarm at the normal time; intention to reality test at the early time) and
 *  Day B (Stage 1's routine), without missing days [D24]. */
export const CAT = { stage1Days: 7, earlyMin: 90, upMin: 90, checkEveryMin: [2, 5] } as const;
export interface CatDay {
  /** 1 = the first morning */
  day: number;
  /** the morning, YYYY-MM-DD */
  date: string;
  stage: 1 | 2;
  /** "early": wake 90 min early and stay up (Stage 1, Day B); "normal": Day A, alarm at the normal time */
  kind: "early" | "normal";
  /** Stage 2's letter */
  letter: "A" | "B" | null;
  /** the alarm, "HH:MM" */
  alarm: string;
}
const ymdUtc = (s: string) => { const [y, m, d] = s.split("-").map(Number) as [number, number, number]; return Date.UTC(y, m - 1, d); };
const utcYmd = (t: number) => new Date(t).toISOString().slice(0, 10);
/** The CAT morning `date` for a plan started on `start` (its first morning) with the normal wake time `wake`; null
 *  before the start or for a date that isn't one. */
export function catDay(start: string, date: string, wake: string): CatDay | null {
  const a = ymdUtc(start), b = ymdUtc(date), w = hmToMin(wake);
  if (!Number.isFinite(a) || !Number.isFinite(b) || w == null || b < a) return null;
  const day = Math.round((b - a) / 86_400_000) + 1;
  if (day <= CAT.stage1Days) return { day, date, stage: 1, kind: "early", letter: null, alarm: minToHm(w - CAT.earlyMin) };
  const letter = (day - CAT.stage1Days) % 2 === 1 ? "A" : "B";
  return { day, date, stage: 2, kind: letter === "A" ? "normal" : "early", letter, alarm: letter === "A" ? minToHm(w) : minToHm(w - CAT.earlyMin) };
}
/** `days` CAT mornings from `from` (default the start). */
export function catSchedule(start: string, wake: string, days = 14, from = start): CatDay[] {
  const out: CatDay[] = [];
  for (let i = 0; i < days; i++) { const d = catDay(start, utcYmd(ymdUtc(from) + i * 86_400_000), wake); if (d) out.push(d); }
  return out;
}

// ----- Sound cue training, targeted lucidity reactivation (TLR) -----
// From the studies (RESEARCH.md Part B §3.6, B42 Carr et al. 2023, B43 Konkoly et al. 2024): the cue is paired with a
// lucid mindset for 20 minutes before sleep [B42]; at home it is replayed from 6 hours after the training [B43]; in
// the lab it was replayed during REM of a morning nap [B42]. Our notes don't record the studies' cue spacing or
// loudness, so those are the app's own settings, said so in the screen: a cue every `CUE_EVERY_SEC` seconds, rising
// from a whisper over the first cues to the chosen volume.
export const CUE_TRAIN_MIN = 20;
export const CUE_NIGHT_DELAY_MIN = 360;
/** The nap window: the LaBerge nap studies' 90-minute nap [D4]. */
export const CUE_NAP_MIN = 90;
/** App's own: minutes after lying down before the first cue in a nap or after WBTB, to let sleep come. */
export const CUE_SETTLE_MIN = [10, 20, 30] as const;
export const CUE_SETTLE_DEFAULT = 20;
/** App's own: seconds between cues in sleep mode, and between pairings in training. */
export const CUE_EVERY_SEC = [15, 30, 60] as const;
export const CUE_EVERY_DEFAULT = 30;
export const CUE_TRAIN_EVERY_SEC = 60;
/** App's own volume steps (WebAudio gain): soft, softer, softest; sleep mode starts at a whisper. */
export const CUE_VOLUMES = { softest: 0.01, softer: 0.02, soft: 0.04 } as const;
export type CueVolume = keyof typeof CUE_VOLUMES;
export const CUE_START_GAIN = 0.002;
export const CUE_RAMP_CUES = 10;
/** The three bundled tones, made with WebAudio (no audio files): frequencies in Hz, played one after the other. */
export const CUE_TONES = {
  bell: { label: "Soft bell", notes: [523.25], type: "sine" },
  rise: { label: "Two notes", notes: [392, 523.25], type: "sine" },
  hum: { label: "Low hum", notes: [196], type: "triangle" },
} as const;
export type CueTone = keyof typeof CUE_TONES;
export const isCueTone = (v: unknown): v is CueTone => typeof v === "string" && v in CUE_TONES;

export type CueWindowKind = "night" | "nap" | "wbtb";
/** When sleep mode cues: "night" from 6 h after training [B43] until the wake time; "nap" and "wbtb" after the settle
 *  time, for a 90-minute nap [D4]. All in ms. */
export function cueWindow(kind: CueWindowKind, o: { now: number; trainedAt?: number | null; wakeAt?: number | null; settleMin?: number }): { start: number; end: number } {
  if (kind === "night") {
    const start = Math.max(o.now, (o.trainedAt ?? o.now) + CUE_NIGHT_DELAY_MIN * 60_000);
    const end = o.wakeAt && o.wakeAt > start ? o.wakeAt : start + CUE_NAP_MIN * 60_000;
    return { start, end };
  }
  const start = o.now + (o.settleMin ?? CUE_SETTLE_DEFAULT) * 60_000;
  return { start, end: start + CUE_NAP_MIN * 60_000 };
}

export interface CueAt { at: number; gain: number }
/** Sleep mode's cues: every `everySec` from `start` to before `end`, the gain rising from CUE_START_GAIN to `gain`
 *  over the first CUE_RAMP_CUES cues. */
export function cueSchedule(start: number, end: number, everySec: number = CUE_EVERY_DEFAULT, gain: number = CUE_VOLUMES.softer): CueAt[] {
  const out: CueAt[] = [], step = Math.max(1, everySec) * 1000;
  for (let t = start, i = 0; t < end; t += step, i++) {
    const f = Math.min(1, i / (CUE_RAMP_CUES - 1));
    out.push({ at: t, gain: +(CUE_START_GAIN + (gain - CUE_START_GAIN) * f).toFixed(5) });
  }
  return out;
}
/** Training: one pairing (the tone, a reality check, the intention) every CUE_TRAIN_EVERY_SEC for 20 minutes [B42]. */
export const trainingPairings = (min: number = CUE_TRAIN_MIN, everySec: number = CUE_TRAIN_EVERY_SEC) => Math.floor((min * 60) / everySec);
