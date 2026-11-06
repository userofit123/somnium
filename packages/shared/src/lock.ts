// The app lock's decisions (PLAN.md §4.3), with no browser in them so they can be tested: given where the lock stands
// and what just happened, where it stands now and what must be done. apps/web/src/core/lock.ts feeds it real events.
// Times are the caller's clock in ms. A clock that runs backwards counts as time passed: the lock fails closed.

export const LOCK_DELAYS: readonly { ms: number; label: string }[] = [
  { ms: 0, label: "Immediately" },
  { ms: 30_000, label: "30 seconds" },
  { ms: 60_000, label: "1 minute" },
  { ms: 300_000, label: "5 minutes" },
  { ms: 900_000, label: "15 minutes" },
];
export const LOCK_IDLE_TIMES: readonly { ms: number; label: string }[] = [
  { ms: 300_000, label: "5 minutes" },
  { ms: 600_000, label: "10 minutes" },
  { ms: 900_000, label: "15 minutes" },
  { ms: 1_800_000, label: "30 minutes" },
];
/** Wrong tries in a row with no wait. Wrong tries never delete or sign out anything; they only cost time. */
export const FREE_WRONG_TRIES = 5;
/** The wait before each further try after those: the last one holds for every try from then on. */
export const WRONG_TRY_WAITS_MS: readonly number[] = [60_000, 300_000, 900_000, 3_600_000];
/** The longest a system dialog (a file picker, the camera, the device's verification) can hold the lock back. */
export const LOCK_HOLD_MAX_MS = 120_000;

export interface LockSettings { delayMs: number; idleMs: number }
export const DEFAULT_LOCK_SETTINGS: LockSettings = { delayMs: 0, idleMs: 600_000 };

/** Saved settings as they may be, made safe: there is no value that turns the lock off or stretches it past the choices. */
export function lockSettingsFrom(saved: unknown): LockSettings {
  const s = (saved ?? {}) as Partial<LockSettings>;
  return {
    delayMs: LOCK_DELAYS.some((d) => d.ms === s.delayMs) ? s.delayMs! : DEFAULT_LOCK_SETTINGS.delayMs,
    idleMs: LOCK_IDLE_TIMES.some((d) => d.ms === s.idleMs) ? s.idleMs! : DEFAULT_LOCK_SETTINGS.idleMs,
  };
}

/** How long a further try has to wait after this many wrong tries in a row. */
export function waitAfterWrongTries(count: number): number {
  if (count < FREE_WRONG_TRIES) return 0;
  return WRONG_TRY_WAITS_MS[Math.min(count - FREE_WRONG_TRIES, WRONG_TRY_WAITS_MS.length - 1)]!;
}

/** What is stored so that reloading or restarting can't skip a wait. */
export interface WrongTries { count: number; lastAt: number | null }

/**
 * What was stored, made safe. It fails closed: a count that calls for a wait with no time beside it waits from now, and
 * a last try "in the future" (the clock was moved back) is taken as now: still the whole wait, and over without
 * anyone having to move the clock forward again.
 */
export function wrongTriesFrom(saved: unknown, at: number): WrongTries {
  const s = (typeof saved === "number" ? { count: saved } : saved ?? {}) as Partial<WrongTries>;
  const count = Number.isInteger(s.count) && s.count! > 0 ? s.count! : 0;
  if (!count) return { count: 0, lastAt: null };
  const lastAt = typeof s.lastAt === "number" && Number.isFinite(s.lastAt) ? Math.min(s.lastAt, at) : waitAfterWrongTries(count) ? at : null;
  return { count, lastAt };
}

/** A wait as the lock screen shows it: rounded up, so it never says 0:00 while still waiting. */
export function formatWait(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000), h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, sec = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** A failed device verification counts only when the device answered with something that doesn't open the key. */
export const deviceFailureCounts = (e: unknown): boolean => (e as Error | null | undefined)?.name === "SealError";

export interface LockState {
  locked: boolean;
  wrongTries: number;
  /** When the last wrong try was; null with none. */
  lastWrongAt: number | null;
  /** When the app was hidden or lost focus, while it still is. */
  awayAt: number | null;
  lastActiveAt: number;
  /** Until when a system dialog holds the lock back; being away during one is not leaving the app. */
  holdUntil: number;
  /** The key is open behind the lock screen (the password was right, and the screen is offering device verification). */
  keyOpenWhileLocked: boolean;
}
export type LockEvent =
  | { type: "away"; at: number }      // hidden, or the desktop window lost focus
  | { type: "back"; at: number }
  | { type: "activity"; at: number }
  | { type: "tick"; at: number }
  | { type: "lock"; at: number }
  | { type: "hold"; at: number; ms: number }
  | { type: "release"; at: number }
  | { type: "unlocked"; at: number }  // the person proved it is them
  | { type: "keyOpened"; at: number } // the key opened, and the lock screen has one more step before the journal shows
  | { type: "wrong"; at: number };    // a wrong password; a cancelled dialog or no connection is not one
export type LockAction = "clearKey";
export interface LockStep { state: LockState; actions: LockAction[] }

/** Every start is locked. Wrong tries and the time of the last one carry over, or reloading would skip the wait. */
export const startLockState = (at: number, saved: unknown = 0): LockState => {
  const tries = wrongTriesFrom(saved, at);
  return { locked: true, wrongTries: tries.count, lastWrongAt: tries.lastAt, awayAt: null, lastActiveAt: at, holdUntil: 0, keyOpenWhileLocked: false };
};

/** How long until the next try may be made; 0 when it may be made now. A clock behind the last try means the whole wait. */
export function wrongTryWaitLeft(s: Pick<LockState, "wrongTries" | "lastWrongAt">, at: number): number {
  const wait = waitAfterWrongTries(s.wrongTries);
  if (!wait || s.lastWrongAt === null) return 0;
  return at < s.lastWrongAt ? wait : Math.max(0, s.lastWrongAt + wait - at);
}

const passed = (at: number, since: number, wait: number) => at < since || at - since >= wait;

export function lockStep(s: LockState, e: LockEvent, cfg: LockSettings): LockStep {
  // the clock went back past the last wrong try: the wait starts over from now, so it ends without moving the clock again
  if (s.lastWrongAt !== null && e.at < s.lastWrongAt) s = { ...s, lastWrongAt: e.at };
  const held = e.at < s.holdUntil;
  const lockNow = (): LockStep => ({ state: { ...s, locked: true, awayAt: null, holdUntil: 0, keyOpenWhileLocked: false }, actions: ["clearKey"] });
  // the same idle time as an open journal: the key must not stay open on a lock screen nobody is looking at
  const dropKeyLeftOpen = (): LockStep => ({ state: { ...s, keyOpenWhileLocked: false }, actions: ["clearKey"] });
  // time away counts from the end of a hold, not from the start of the dialog
  const awayTooLong = () => s.awayAt !== null && passed(e.at, Math.max(s.awayAt, s.holdUntil), cfg.delayMs);
  const idleTooLong = () => passed(e.at, Math.max(s.lastActiveAt, s.holdUntil), cfg.idleMs);

  switch (e.type) {
    case "lock":
      return lockNow();
    case "unlocked":
      return { state: { ...s, locked: false, wrongTries: 0, lastWrongAt: null, awayAt: null, lastActiveAt: e.at, holdUntil: 0, keyOpenWhileLocked: false }, actions: [] };
    case "keyOpened":
      // the key opening is the proof, so the count starts over here, whatever this step leads to
      return { state: s.locked ? { ...s, wrongTries: 0, lastWrongAt: null, keyOpenWhileLocked: true, lastActiveAt: e.at } : s, actions: [] };
    case "wrong": {
      // a try during a wait isn't one: the lock screen refuses it before looking at the password
      if (!s.locked || wrongTryWaitLeft(s, e.at) > 0) return { state: s, actions: [] };
      return { state: { ...s, wrongTries: s.wrongTries + 1, lastWrongAt: e.at }, actions: [] };
    }
    case "hold":
      return { state: { ...s, holdUntil: e.at + Math.min(e.ms, LOCK_HOLD_MAX_MS) }, actions: [] };
    case "release":
      // still away when the dialog ends: the wait starts now
      if (s.awayAt === null) return { state: { ...s, holdUntil: 0 }, actions: [] };
      return lockStep({ ...s, holdUntil: 0, awayAt: e.at }, { type: "away", at: e.at }, cfg);
    case "away": {
      const next = { ...s, awayAt: s.awayAt ?? e.at };
      if (held) return { state: next, actions: [] };
      // on the lock screen the key may be open for a moment (offering device verification): it doesn't stay open out of sight
      if (s.locked) return { state: { ...next, keyOpenWhileLocked: false }, actions: ["clearKey"] };
      return cfg.delayMs === 0 ? { state: { ...next, locked: true, awayAt: null, holdUntil: 0 }, actions: ["clearKey"] } : { state: next, actions: [] };
    }
    case "back":
      if (!s.locked && !held && (awayTooLong() || idleTooLong())) return lockNow();
      if (s.keyOpenWhileLocked && !held && idleTooLong()) return { state: { ...s, awayAt: null, keyOpenWhileLocked: false }, actions: ["clearKey"] };
      return { state: { ...s, awayAt: null, lastActiveAt: s.locked && !s.keyOpenWhileLocked ? s.lastActiveAt : e.at }, actions: [] };
    case "activity":
      // checked first: the first tap after waking a sleeping computer must not count as having been here all along
      if (s.keyOpenWhileLocked) return !held && idleTooLong() ? dropKeyLeftOpen() : { state: { ...s, lastActiveAt: e.at }, actions: [] };
      if (s.locked) return { state: s, actions: [] };
      if (!held && (awayTooLong() || idleTooLong())) return lockNow();
      return { state: { ...s, lastActiveAt: e.at }, actions: [] };
    case "tick":
      if (held) return { state: s, actions: [] };
      if (s.locked && s.awayAt !== null) return { state: { ...s, keyOpenWhileLocked: false }, actions: ["clearKey"] };
      if (s.keyOpenWhileLocked) return idleTooLong() ? dropKeyLeftOpen() : { state: s, actions: [] };
      if (s.locked) return { state: s, actions: [] };
      return awayTooLong() || idleTooLong() ? lockNow() : { state: s, actions: [] };
  }
}
