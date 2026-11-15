// What the guided screens share (LDJ-25): the screen kept awake while a timer runs (Screen Wake Lock API where the
// browser has it; nothing happens where it doesn't), a clock that counts from a start time (so a slowed background
// tab or a sleeping phone catches up instead of drifting), and the quiet tones (LDJ-115: with the screen off on
// Android, on the page's audio clock elsewhere).
import { onBeforeUnmount, ref } from "vue";
import type { NightCue } from "@somnium/shared";
import { nightAudio, playNightTones, stopNightTones } from "../../../native/nightAudio";
import { lock } from "../../../core/lock";

interface Sentinel { released: boolean; release(): Promise<void>; addEventListener(t: "release", f: () => void): void }

export function useWakeLock() {
  const held = ref(false);
  let want = false, s: Sentinel | null = null;
  async function grab() {
    const wl = (navigator as any).wakeLock;
    if (!want || !wl || document.visibilityState !== "visible" || (s && !s.released)) return;
    try {
      s = await wl.request("screen");
      held.value = true;
      s!.addEventListener("release", () => { held.value = false; });
    } catch { held.value = false; } // refused (battery saver, no permission): the timer works without it
  }
  // the browser drops the lock when the page is hidden; take it again on return
  const onVis = () => { void grab(); };
  document.addEventListener("visibilitychange", onVis);
  async function on() { want = true; await grab(); }
  async function off() { want = false; const x = s; s = null; held.value = false; await x?.release().catch(() => {}); }
  onBeforeUnmount(() => { document.removeEventListener("visibilitychange", onVis); void off(); });
  return { held, on, off, supported: typeof navigator !== "undefined" && "wakeLock" in navigator };
}

// How many guided timers are running here: while any is, the desktop app holds back everything about an update (its
// notification, the restart), as Motus does during a workout (apps/desktop/src/main.ts guidedBusy).
let runningTimers = 0;
const tellBusy = () => { try { void (globalThis as any).somniumNative?.setBusy?.(runningTimers > 0)?.catch?.(() => {}); } catch { /* not the desktop app */ } };

/** Seconds since start(), updated twice a second while running. */
export function useClock() {
  const sec = ref(0), running = ref(false);
  let t0 = 0, iv: ReturnType<typeof setInterval> | null = null;
  const upd = () => { sec.value = Math.floor((Date.now() - t0) / 1000); };
  function start(from = Date.now()) { t0 = from; if (!running.value) { runningTimers++; tellBusy(); } running.value = true; upd(); if (iv) clearInterval(iv); iv = setInterval(upd, 500); }
  function stop() { if (running.value) { runningTimers = Math.max(0, runningTimers - 1); tellBusy(); } running.value = false; if (iv) clearInterval(iv); iv = null; }
  onBeforeUnmount(stop);
  return { sec, running, start, stop };
}

/**
 * Sound cue training's tones (LDJ-48): the three bundled cues made with WebAudio (no audio files), each note a soft
 * sine or triangle with a slow attack and a long fade, so it never clicks. `at` is a moment (ms); the note is put on
 * the audio clock, which keeps time even where a background tab's timers are slowed. `scheduled` counts the cues put
 * on the clock (the screen shows it; a headless check reads it, since nothing can be heard there).
 */
export function createCuePlayer() {
  let ctx: AudioContext | null = null;
  const scheduled = ref(0);
  function prime() { try { ctx ??= new AudioContext(); void ctx.resume(); } catch { ctx = null; } return !!ctx; }
  function cue(tone: { notes: readonly number[]; type: string }, gain: number, at = Date.now()) {
    if (!ctx) return false;
    const t0 = ctx.currentTime + Math.max(0, (at - Date.now()) / 1000);
    tone.notes.forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain(), t = t0 + i * 0.45;
      o.type = tone.type as OscillatorType; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
      o.connect(g).connect(ctx!.destination); o.start(t); o.stop(t + 1.5);
    });
    scheduled.value++;
    return true;
  }
  /** Stops every cue still on the clock. */
  async function close() { const c = ctx; ctx = null; await c?.close().catch(() => {}); }
  return { prime, cue, close, scheduled, state: () => ctx?.state ?? "closed" };
}
/** The same, closed when the screen goes. */
export function useCuePlayer() { const p = createCuePlayer(); onBeforeUnmount(() => { void p.close(); }); return p; }

/**
 * A guided screen's tones (LDJ-115), given as one schedule at the start. On Android a foreground service plays them
 * with the screen off (`offScreen`), so the screen need not stay lit; elsewhere they go on this page's audio clock and
 * play only while it is open and the screen on. Call `play` inside the tap that starts the timer (the audio needs it).
 * When the screen goes the tones stop, except when the app lock took it away (a person asleep is idle; the schedule
 * then ends by itself) or `keep` is set (the screen is left on purpose and comes back, as "I'm up" does).
 */
export function useNightTones(o: { keep?: boolean } = {}) {
  const offScreen = !!nightAudio();
  const player = offScreen ? null : createCuePlayer();
  let on = false;
  /** False when nothing will play (no audio here, or nothing left in the schedule). */
  async function play(cues: readonly NightCue[], end: number): Promise<boolean> {
    if (!player) { on = await playNightTones(cues, end); return on; }
    if (!player.prime()) return false;
    const now = Date.now();
    for (const c of cues) if (c.at >= now - 1000 && c.at < end) player.cue({ notes: c.notes, type: c.wave }, c.gain, c.at);
    on = true;
    return true;
  }
  async function stop() {
    if (!on) return;
    on = false;
    if (player) await player.close(); else await stopNightTones();
  }
  onBeforeUnmount(() => {
    if (player) { void player.close(); return; }
    if (on && !o.keep && !lock.locked) void stop();
  });
  return { offScreen, play, stop };
}
