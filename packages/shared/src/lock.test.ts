import { describe, expect, it } from "vitest";
import { DEFAULT_LOCK_SETTINGS, LOCK_HOLD_MAX_MS, MAX_WRONG_TRIES, lockSettingsFrom, lockStep, startLockState, type LockEvent, type LockSettings, type LockState } from "./lock";

const T0 = 1_000_000;
const cfg = (delayMs = 0, idleMs = 600_000): LockSettings => ({ delayMs, idleMs });
const open = (at = T0): LockState => lockStep(startLockState(at), { type: "unlocked", at }, cfg()).state;
/** Runs events one after the other and returns where the lock ends and every action asked for on the way. */
function run(s: LockState, events: LockEvent[], c: LockSettings) {
  const actions: string[] = [];
  for (const e of events) { const r = lockStep(s, e, c); s = r.state; actions.push(...r.actions); }
  return { s, actions };
}

describe("app lock", () => {
  it("is locked on every start and carries wrong tries over a reload", () => {
    expect(startLockState(T0).locked).toBe(true);
    expect(startLockState(T0, 3).wrongTries).toBe(3);
  });

  it("locks and clears the key the moment the app is hidden with the default delay", () => {
    const r = lockStep(open(), { type: "away", at: T0 + 1 }, DEFAULT_LOCK_SETTINGS);
    expect(r.state.locked).toBe(true);
    expect(r.actions).toEqual(["clearKey"]);
  });

  it.each([30_000, 60_000, 300_000, 900_000])("waits %i ms when away, then locks on the tick", (delay) => {
    const c = cfg(delay, 3_600_000);
    const away = lockStep(open(), { type: "away", at: T0 }, c).state;
    expect(away.locked).toBe(false);
    expect(lockStep(away, { type: "tick", at: T0 + delay - 1 }, c).state.locked).toBe(false);
    const r = lockStep(away, { type: "tick", at: T0 + delay }, c);
    expect(r.state.locked).toBe(true);
    expect(r.actions).toEqual(["clearKey"]);
  });

  it("stays open when back inside the delay, and locks when back after it even if no tick ran", () => {
    const c = cfg(30_000, 3_600_000);
    const away = lockStep(open(), { type: "away", at: T0 }, c).state;
    const soon = lockStep(away, { type: "back", at: T0 + 29_999 }, c);
    expect(soon.state.locked).toBe(false);
    expect(soon.state.awayAt).toBeNull();
    // a browser throttles timers in a hidden tab, so coming back has to check for itself
    expect(lockStep(away, { type: "back", at: T0 + 30_000 }, c).state.locked).toBe(true);
  });

  it("measures from the first time away: blur then hidden doesn't restart the wait", () => {
    const c = cfg(30_000, 3_600_000);
    const { s } = run(open(), [{ type: "away", at: T0 }, { type: "away", at: T0 + 20_000 }, { type: "tick", at: T0 + 30_000 }], c);
    expect(s.locked).toBe(true);
  });

  it("locks when idle, and activity pushes that back", () => {
    const c = cfg(0, 600_000);
    expect(lockStep(open(), { type: "tick", at: T0 + 599_999 }, c).state.locked).toBe(false);
    expect(lockStep(open(), { type: "tick", at: T0 + 600_000 }, c).state.locked).toBe(true);
    const { s } = run(open(), [{ type: "activity", at: T0 + 500_000 }, { type: "tick", at: T0 + 700_000 }], c);
    expect(s.locked).toBe(false);
  });

  it("a tap after the computer slept locks instead of counting as activity", () => {
    const r = lockStep(open(), { type: "activity", at: T0 + 700_000 }, cfg(0, 600_000));
    expect(r.state.locked).toBe(true);
    expect(r.actions).toEqual(["clearKey"]);
  });

  it("idle time also runs while away on a long delay", () => {
    const c = cfg(900_000, 300_000);
    const { s } = run(open(), [{ type: "away", at: T0 }, { type: "tick", at: T0 + 300_000 }], c);
    expect(s.locked).toBe(true);
  });

  it("fails closed when the clock runs backwards", () => {
    const c = cfg(30_000);
    const away = lockStep(open(), { type: "away", at: T0 }, c).state;
    expect(lockStep(away, { type: "back", at: T0 - 5_000 }, c).state.locked).toBe(true);
  });

  it("a system dialog holds the lock back, and the wait starts when it ends", () => {
    const c = cfg(0);
    const held = run(open(), [{ type: "hold", at: T0, ms: 60_000 }, { type: "away", at: T0 + 1 }, { type: "tick", at: T0 + 2 }], c);
    expect(held.s.locked).toBe(false);
    expect(held.actions).toEqual([]);
    // came back during the dialog: nothing to do
    const back = run(held.s, [{ type: "back", at: T0 + 3 }, { type: "release", at: T0 + 4 }], c);
    expect(back.s.locked).toBe(false);
    // dialog over and still away: locks
    const gone = lockStep(held.s, { type: "release", at: T0 + 4 }, c);
    expect(gone.state.locked).toBe(true);
    expect(gone.actions).toEqual(["clearKey"]);
  });

  it("a hold can't last past its limit", () => {
    const c = cfg(0);
    const { s } = run(open(), [{ type: "hold", at: T0, ms: 99_999_999 }, { type: "away", at: T0 + 1 }, { type: "tick", at: T0 + LOCK_HOLD_MAX_MS - 1 }], c);
    expect(s.locked).toBe(false);
    expect(lockStep(s, { type: "tick", at: T0 + LOCK_HOLD_MAX_MS }, c).state.locked).toBe(true);
  });

  it("clears a key opened on the lock screen as soon as the app is out of sight", () => {
    expect(lockStep(startLockState(T0), { type: "away", at: T0 + 1 }, cfg()).actions).toEqual(["clearKey"]);
  });

  it("signs out on the fifth wrong try, not before, and a good try starts the count over", () => {
    let s = startLockState(T0);
    for (let i = 1; i < MAX_WRONG_TRIES; i++) {
      const r = lockStep(s, { type: "wrong", at: T0 + i }, cfg());
      s = r.state;
      expect(r.actions).toEqual([]);
      expect(s.wrongTries).toBe(i);
    }
    expect(lockStep(s, { type: "wrong", at: T0 + 9 }, cfg()).actions).toEqual(["clearKey", "signOut"]);
    const good = lockStep(s, { type: "unlocked", at: T0 + 9 }, cfg()).state;
    expect(good.wrongTries).toBe(0);
    expect(good.locked).toBe(false);
  });

  it("counts tries carried over a reload towards the five", () => {
    expect(lockStep(startLockState(T0, 4), { type: "wrong", at: T0 }, cfg()).actions).toContain("signOut");
  });

  it("ignores saved settings that aren't among the choices, so no value turns the lock off", () => {
    expect(lockSettingsFrom({ delayMs: 86_400_000, idleMs: 0 })).toEqual(DEFAULT_LOCK_SETTINGS);
    expect(lockSettingsFrom(null)).toEqual(DEFAULT_LOCK_SETTINGS);
    expect(lockSettingsFrom({ delayMs: 60_000, idleMs: 300_000 })).toEqual({ delayMs: 60_000, idleMs: 300_000 });
  });
});
