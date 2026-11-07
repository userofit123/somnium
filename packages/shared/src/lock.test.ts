import { describe, expect, it } from "vitest";
import { DEFAULT_LOCK_SETTINGS, FREE_WRONG_TRIES, LOCK_HOLD_MAX_MS, WRONG_TRY_WAITS_MS, deviceFailureCounts, devicePath, formatWait, lockSettingsFrom, lockStep, startLockState, waitAfterWrongTries, wrongTriesFrom, wrongTryWaitLeft, type LockEvent, type LockSettings, type LockState } from "./lock";

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

  it("ignores saved settings that aren't among the choices, so no value turns the lock off", () => {
    expect(lockSettingsFrom({ delayMs: 86_400_000, idleMs: 0 })).toEqual(DEFAULT_LOCK_SETTINGS);
    expect(lockSettingsFrom(null)).toEqual(DEFAULT_LOCK_SETTINGS);
    expect(lockSettingsFrom({ delayMs: 60_000, idleMs: 300_000 })).toEqual({ delayMs: 60_000, idleMs: 300_000 });
  });

  describe("with the key open on the lock screen (offering device verification)", () => {
    const idle = 300_000, c = cfg(0, idle);
    const offering = (at = T0) => lockStep(startLockState(at), { type: "keyOpened", at }, c).state;

    it("drops the key once idle, and stays locked", () => {
      expect(lockStep(offering(), { type: "tick", at: T0 + idle - 1 }, c).actions).toEqual([]);
      const r = lockStep(offering(), { type: "tick", at: T0 + idle }, c);
      expect(r.actions).toEqual(["clearKey"]);
      expect(r.state.locked).toBe(true);
      expect(r.state.keyOpenWhileLocked).toBe(false);
    });
    it("asks only once, and a plain lock screen has nothing to drop", () => {
      const once = lockStep(offering(), { type: "tick", at: T0 + idle }, c).state;
      expect(lockStep(once, { type: "tick", at: T0 + idle + 1000 }, c).actions).toEqual([]);
      expect(lockStep(startLockState(T0), { type: "tick", at: T0 + idle * 10 }, c).actions).toEqual([]);
    });
    it("counts activity on that step as being here", () => {
      const moved = lockStep(offering(), { type: "activity", at: T0 + idle - 1 }, c).state;
      expect(moved.locked).toBe(true);
      expect(lockStep(moved, { type: "tick", at: T0 + idle + 1 }, c).actions).toEqual([]);
    });
    it("doesn't take the first tap after the idle time as being here", () => {
      expect(lockStep(offering(), { type: "activity", at: T0 + idle }, c).actions).toEqual(["clearKey"]);
    });
    it("waits while the device's verification dialog is open", () => {
      const held = lockStep(offering(), { type: "hold", at: T0 + idle - 1, ms: 60_000 }, c).state;
      expect(lockStep(held, { type: "tick", at: T0 + idle + 1 }, c).actions).toEqual([]);
    });
    it("is over once the journal opens", () => {
      const s = lockStep(offering(), { type: "unlocked", at: T0 + 1 }, c).state;
      expect(s.keyOpenWhileLocked).toBe(false);
      expect(s.locked).toBe(false);
    });
    it("drops the key on leaving, and it is not asked for again on the way back", () => {
      const away = lockStep(offering(), { type: "away", at: T0 + 1 }, c);
      expect(away.actions).toEqual(["clearKey"]);
      expect(away.state.keyOpenWhileLocked).toBe(false);
    });
  });

  describe("wrong tries cost time, and nothing else", () => {
    const MIN = 60_000, c = cfg();
    const wrong = (s: LockState, at: number) => lockStep(s, { type: "wrong", at }, c);
    /** Wrong tries one after the other, each as soon as it is allowed. Returns the state and the time of the last. */
    function wrongTries(n: number, from = T0) {
      let s = startLockState(from), at = from;
      for (let i = 0; i < n; i++) { at += wrongTryWaitLeft(s, at); s = wrong(s, at).state; }
      return { s, at };
    }

    it("waits 1, 5 and 15 minutes after the fifth, then an hour for every try after that", () => {
      expect([0, 4, 5, 6, 7, 8, 9, 50].map(waitAfterWrongTries)).toEqual([0, 0, MIN, 5 * MIN, 15 * MIN, 60 * MIN, 60 * MIN, 60 * MIN]);
      expect(WRONG_TRY_WAITS_MS).toHaveLength(4);
      for (const n of [5, 6, 7, 8, 9]) {
        const { s, at } = wrongTries(n);
        expect(s.wrongTries).toBe(n);
        expect(wrongTryWaitLeft(s, at)).toBe(waitAfterWrongTries(n));
      }
    });
    it("never asks to delete or sign out anything, however many tries", () => {
      let s = startLockState(T0), at = T0;
      for (let i = 0; i < 12; i++) {
        at += wrongTryWaitLeft(s, at);
        const r = wrong(s, at);
        expect(r.actions).toEqual([]);
        expect(r.state.locked).toBe(true);
        s = r.state;
      }
    });
    it("doesn't count a try made during a wait, nor let it shorten the wait", () => {
      const { s, at } = wrongTries(5);
      const r = wrong(s, at + 1000);
      expect(r.state.wrongTries).toBe(5);
      expect(r.state.lastWrongAt).toBe(at);
      expect(wrongTryWaitLeft(r.state, at + MIN)).toBe(0);
    });
    it("stays locked through the wait, and has no wait before the fifth", () => {
      const { s, at } = wrongTries(4);
      expect(wrongTryWaitLeft(s, at)).toBe(0);
      const after = lockStep(wrongTries(5).s, { type: "tick", at: T0 + 1000 }, c).state;
      expect(after.locked).toBe(true);
    });
    it("starts over on the right password, also when the lock screen has one more step", () => {
      const { s, at } = wrongTries(6);
      const good = lockStep(s, { type: "unlocked", at: at + 1 }, c).state;
      expect([good.wrongTries, good.lastWrongAt, wrongTryWaitLeft(good, at + 1)]).toEqual([0, null, 0]);
      const offered = lockStep(s, { type: "keyOpened", at: at + 1 }, c).state;
      expect([offered.wrongTries, offered.lastWrongAt]).toEqual([0, null]);
    });

    describe("reloading", () => {
      /** What the app stores and reads back. */
      const reload = (s: LockState, at: number) => startLockState(at, JSON.parse(JSON.stringify({ count: s.wrongTries, lastAt: s.lastWrongAt })));

      it("can't skip the wait, however often it happens", () => {
        const { s, at } = wrongTries(6);
        let now = at, again = s;
        for (let i = 0; i < 20; i++) { now += 1000; again = reload(again, now); expect(wrongTryWaitLeft(again, now)).toBe(5 * MIN - (now - at)); }
        expect(wrong(again, now).state.wrongTries).toBe(6);
      });
      it("keeps counting up from where it was", () => {
        const { s, at } = wrongTries(5);
        const later = at + MIN;
        const next = wrong(reload(s, later), later).state;
        expect(next.wrongTries).toBe(6);
        expect(wrongTryWaitLeft(reload(next, later), later)).toBe(5 * MIN);
      });
      it("waits from now when the time of the last try is missing or spoiled", () => {
        for (const saved of [5, { count: 5 }, { count: 5, lastAt: "soon" }, { count: 5, lastAt: null }])
          expect(wrongTryWaitLeft(startLockState(T0, saved), T0)).toBe(MIN);
      });
      it("takes nonsense as no wrong tries", () => {
        for (const saved of [null, undefined, "x", -2, 1.5, {}, { count: "9" }]) expect(wrongTriesFrom(saved, T0)).toEqual({ count: 0, lastAt: null });
      });
    });

    describe("a clock moved back", () => {
      it("is still waiting, for the whole wait", () => {
        const { s, at } = wrongTries(5);
        expect(wrongTryWaitLeft(s, at - 3_600_000)).toBe(MIN);
        expect(wrong(s, at - 3_600_000).state.wrongTries).toBe(5);
      });
      it("doesn't need moving forward again: the wait ends a whole wait after it was noticed", () => {
        const { s, at } = wrongTries(5), back = at - 3_600_000;
        const noticed = lockStep(s, { type: "tick", at: back }, c).state;
        expect(noticed.lastWrongAt).toBe(back);
        expect(wrongTryWaitLeft(noticed, back + MIN - 1)).toBe(1);
        expect(wrongTryWaitLeft(noticed, back + MIN)).toBe(0);
      });
      it("is the same when found on a start", () => {
        const { s, at } = wrongTries(5), back = at - 3_600_000;
        const started = startLockState(back, { count: s.wrongTries, lastAt: s.lastWrongAt });
        expect(started.lastWrongAt).toBe(back);
        expect(wrongTryWaitLeft(started, back)).toBe(MIN);
        expect(started.locked).toBe(true);
      });
    });

    it("counts a device verification only when it answered with the wrong thing", () => {
      const named = (name: string) => Object.assign(new Error("x"), { name });
      expect(deviceFailureCounts(named("SealError"))).toBe(true);
      for (const e of [named("NotAllowedError"), named("AbortError"), named("TypeError"), new Error("no connection"), null]) expect(deviceFailureCounts(e)).toBe(false);
    });
    it("shows the wait plainly, never as nothing while still waiting", () => {
      expect([1, 999, 60_000, 299_001, 3_600_000, 0].map(formatWait)).toEqual(["0:01", "0:01", "1:00", "5:00", "1:00:00", "0:00"]);
    });
  });
});

describe("device verification path (LDJ-9)", () => {
  it("uses the Keystore in the Android app, WebAuthn in a browser, and the password otherwise", () => {
    expect(devicePath({ native: true, held: true, hasBlob: true })).toBe("android");
    // the Android app never falls back to a WebAuthn credential, even one left in storage
    expect(devicePath({ native: true, cred: true })).toBe("password");
    // the record says on, but the blob went (the Keystore key ended, or the account signed out): the password
    expect(devicePath({ native: true, held: true, hasBlob: false })).toBe("password");
    expect(devicePath({ native: false, cred: true })).toBe("webauthn");
    expect(devicePath({ native: false, held: true, hasBlob: true })).toBe("password");
    expect(devicePath({ native: true, held: true, hasBlob: true, off: true })).toBe("password");
    expect(devicePath({ native: false, cred: true, off: true })).toBe("password");
    expect(devicePath({ native: false })).toBe("password");
  });
  it("counts what the phone answers like the browser: a blob that doesn't open counts, a cancelled prompt or a notice never", () => {
    const named = (name: string) => Object.assign(new Error(name), { name });
    expect(deviceFailureCounts(named("SealError"))).toBe(true);
    for (const n of ["NotAllowedError", "DeviceNotice", "Error"]) expect(deviceFailureCounts(named(n))).toBe(false);
  });
});
