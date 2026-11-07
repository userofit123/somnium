// Sound cue's sleep session (LDJ-48), kept outside the screen on purpose: the app lock (10 minutes idle by default)
// takes every screen away, and a person asleep is idle. The session holds nothing from the journal (a tone, times and
// a count), so it may go on behind the lock: the cues stay on the audio clock, any touch or key (the lock screen's
// included) stops it, and so does the window's end. Logging "sound-cue" on the night needs the journal key, so when
// it is locked the log waits on this device (PENDING) and goes on the next open of Train (flushCueLog).
import { ref } from "vue";
import { cueSchedule, CUE_TONES, type CueAt, type CueTone } from "@somnium/shared";
import { logTechniqueDone, nightNowDate } from "../../../api/train";
import { readStr, writeStr } from "../../../core/prefs";
import { createCuePlayer } from "./useGuided";

const PENDING = "somniumCuePending";
export const cueSession = {
  on: ref(false),
  played: ref(0),
  win: ref<{ start: number; end: number } | null>(null),
  nextAt: ref<number | null>(null),
  wakeHeld: ref(false),
  /** cues put on the audio clock (a headless check reads it) */
  scheduled: ref(0),
};
let player: ReturnType<typeof createCuePlayer> | null = null, cues: CueAt[] = [], queued = 0, tone: CueTone = "bell";
let iv: ReturnType<typeof setInterval> | null = null, wl: { release(): Promise<void> } | null = null, onEnd: ((n: number) => void) | null = null;

async function grabWake() {
  const w = (navigator as any).wakeLock;
  if (!cueSession.on.value || !w || document.visibilityState !== "visible") return;
  try { wl = await w.request("screen"); cueSession.wakeHeld.value = true; (wl as any).addEventListener?.("release", () => { cueSession.wakeHeld.value = false; }); } catch { cueSession.wakeHeld.value = false; }
}
const onVis = () => { void grabWake(); };
const onTouch = (e: Event) => { e.preventDefault(); e.stopPropagation(); void stopCueSession(); };

/** Starts the cues for a window; call inside the tap (the audio needs it). False when this browser can't play sound. */
export function startCueSession(o: { win: { start: number; end: number }; everySec: number; gain: number; tone: CueTone; ended?: (played: number) => void }): boolean {
  if (cueSession.on.value) return true;
  player = createCuePlayer();
  if (!player.prime()) { player = null; return false; }
  tone = o.tone; onEnd = o.ended ?? null;
  cues = cueSchedule(o.win.start, o.win.end, o.everySec, o.gain); queued = 0;
  cueSession.win.value = o.win; cueSession.played.value = 0; cueSession.scheduled.value = 0; cueSession.on.value = true;
  void grabWake(); document.addEventListener("visibilitychange", onVis);
  iv = setInterval(tick, 1000); tick();
  // any touch or key stops it; added once this tap has finished
  setTimeout(() => { if (cueSession.on.value) { window.addEventListener("pointerdown", onTouch, true); window.addEventListener("keydown", onTouch, true); } }, 400);
  return true;
}
// cues go on the audio clock a minute ahead, so a slowed timer can't make one late
function tick() {
  const now = Date.now(), w = cueSession.win.value;
  if (!w || now >= w.end) { void stopCueSession(); return; }
  while (player && queued < cues.length && cues[queued]!.at <= now + 60_000) { if (player.cue(CUE_TONES[tone], cues[queued]!.gain, cues[queued]!.at)) cueSession.scheduled.value++; queued++; }
  cueSession.played.value = cues.filter((c) => c.at <= now).length;
  cueSession.nextAt.value = cues.find((c) => c.at > now)?.at ?? null;
}

/** Stops the cues; with any played, logs "sound-cue" on the night (or keeps it for later while locked). */
export async function stopCueSession(): Promise<number> {
  if (!cueSession.on.value) return 0;
  cueSession.on.value = false;
  window.removeEventListener("pointerdown", onTouch, true); window.removeEventListener("keydown", onTouch, true);
  document.removeEventListener("visibilitychange", onVis);
  if (iv) clearInterval(iv); iv = null;
  const n = cues.filter((c) => c.at <= Date.now()).length;
  cueSession.played.value = n;
  await player?.close(); player = null;
  const x = wl; wl = null; cueSession.wakeHeld.value = false; await x?.release().catch(() => {});
  if (n > 0) { writeStr(PENDING, nightNowDate()); await flushCueLog(); }
  onEnd?.(n); onEnd = null;
  return n;
}
/** Writes a waiting "sound-cue" log (see above); quiet when the journal is still locked. */
export async function flushCueLog(): Promise<boolean> {
  const date = readStr(PENDING, "");
  if (!date) return false;
  try { await logTechniqueDone("sound-cue", date); writeStr(PENDING, ""); return true; } catch { return false; }
}
