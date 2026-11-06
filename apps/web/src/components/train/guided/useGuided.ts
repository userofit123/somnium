// What the guided screens share (LDJ-25): the screen kept awake while a timer runs (Screen Wake Lock API where the
// browser has it; nothing happens where it doesn't), a clock that counts from a start time (so a slowed background
// tab or a sleeping phone catches up instead of drifting), and an optional quiet tone.
import { onBeforeUnmount, ref } from "vue";

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

/** Seconds since start(), updated twice a second while running. */
export function useClock() {
  const sec = ref(0), running = ref(false);
  let t0 = 0, iv: ReturnType<typeof setInterval> | null = null;
  const upd = () => { sec.value = Math.floor((Date.now() - t0) / 1000); };
  function start(from = Date.now()) { t0 = from; running.value = true; upd(); if (iv) clearInterval(iv); iv = setInterval(upd, 500); }
  function stop() { running.value = false; if (iv) clearInterval(iv); iv = null; }
  onBeforeUnmount(stop);
  return { sec, running, start, stop };
}

/** A short, very quiet sine tone (no voice). Made on first use, inside the tap that started the timer. */
export function useTone() {
  let ctx: AudioContext | null = null;
  function prime() { try { ctx ??= new AudioContext(); void ctx.resume(); } catch { ctx = null; } }
  function play(freq = 196) {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.04, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 1);
  }
  onBeforeUnmount(() => { void ctx?.close().catch(() => {}); ctx = null; });
  return { prime, play };
}
