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
export const MAX_WRONG_TRIES = 5;
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

export interface LockState {
  locked: boolean;
  wrongTries: number;
  /** When the app was hidden or lost focus, while it still is. */
  awayAt: number | null;
  lastActiveAt: number;
  /** Until when a system dialog holds the lock back; being away during one is not leaving the app. */
  holdUntil: number;
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
  | { type: "wrong"; at: number };    // a wrong password; a cancelled dialog or no connection is not one
export type LockAction = "clearKey" | "signOut";
export interface LockStep { state: LockState; actions: LockAction[] }

/** Every start is locked. Wrong tries carry over from before the reload, or reloading would reset the count. */
export const startLockState = (at: number, wrongTries = 0): LockState =>
  ({ locked: true, wrongTries, awayAt: null, lastActiveAt: at, holdUntil: 0 });

const passed = (at: number, since: number, wait: number) => at < since || at - since >= wait;

export function lockStep(s: LockState, e: LockEvent, cfg: LockSettings): LockStep {
  const held = e.at < s.holdUntil;
  const lockNow = (): LockStep => ({ state: { ...s, locked: true, awayAt: null, holdUntil: 0 }, actions: ["clearKey"] });
  // time away counts from the end of a hold, not from the start of the dialog
  const awayTooLong = () => s.awayAt !== null && passed(e.at, Math.max(s.awayAt, s.holdUntil), cfg.delayMs);
  const idleTooLong = () => passed(e.at, Math.max(s.lastActiveAt, s.holdUntil), cfg.idleMs);

  switch (e.type) {
    case "lock":
      return lockNow();
    case "unlocked":
      return { state: { ...s, locked: false, wrongTries: 0, awayAt: null, lastActiveAt: e.at, holdUntil: 0 }, actions: [] };
    case "wrong": {
      if (!s.locked) return { state: s, actions: [] };
      const wrongTries = s.wrongTries + 1;
      return { state: { ...s, wrongTries }, actions: wrongTries >= MAX_WRONG_TRIES ? ["clearKey", "signOut"] : [] };
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
      if (s.locked) return { state: next, actions: ["clearKey"] };
      return cfg.delayMs === 0 ? { state: { ...next, locked: true, awayAt: null, holdUntil: 0 }, actions: ["clearKey"] } : { state: next, actions: [] };
    }
    case "back":
      if (!s.locked && !held && (awayTooLong() || idleTooLong())) return lockNow();
      return { state: { ...s, awayAt: null, lastActiveAt: s.locked ? s.lastActiveAt : e.at }, actions: [] };
    case "activity":
      // checked first: the first tap after waking a sleeping computer must not count as having been here all along
      if (s.locked) return { state: s, actions: [] };
      if (!held && (awayTooLong() || idleTooLong())) return lockNow();
      return { state: { ...s, lastActiveAt: e.at }, actions: [] };
    case "tick":
      if (held) return { state: s, actions: [] };
      if (s.locked) return { state: s, actions: s.awayAt !== null ? ["clearKey"] : [] };
      return awayTooLong() || idleTooLong() ? lockNow() : { state: s, actions: [] };
  }
}
