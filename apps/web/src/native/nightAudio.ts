// Night practice tones with the screen off on Android (LDJ-115): the guided screens' tone schedule (shared guided.ts
// NightCue) handed to SomniumNightAudioPlugin, whose foreground service plays it while the phone sleeps and stops by
// itself after the last tone. Only tones and times cross, nothing from the journal; the service's notification is
// generic ("Night practice running", Stop). Elsewhere (web, desktop) there is no such service: the screens play the
// same schedule with WebAudio while the page is open and the screen on (useGuided.ts useNightTones).
import { nightCuesAhead, type NightCue } from "@somnium/shared";

interface NightAudioPlugin {
  start(o: { cues: NightCue[]; end: number }): Promise<void>;
  stop(): Promise<{ running: boolean; played: number }>;
  status(): Promise<{ running: boolean; played: number }>;
  addListener(ev: "ended", f: (r: { played: number }) => void): Promise<{ remove(): Promise<void> }>;
}

export const nightAudio = (): NightAudioPlugin | undefined =>
  (globalThis as any).Capacitor?.getPlatform?.() === "android" ? (globalThis as any).Capacitor?.Plugins?.SomniumNightAudio : undefined;

// one listener for the app's life, so an "ended" kept from a run nobody watched any more is used up at once and can't
// reach the next screen that listens
const subs = new Set<(played: number) => void>();
let hooked = false;
function hook(p: NightAudioPlugin) {
  if (hooked) return;
  hooked = true;
  void p.addListener("ended", (r) => { for (const f of [...subs]) f(Number(r?.played) || 0); }).catch(() => { hooked = false; });
}
{ const p = nightAudio(); if (p) hook(p); }

/** Plays the cues still to come with the screen off; false where there is no such service (or nothing is left). A new
 *  schedule replaces the one playing. `end` is when the service stops at the latest. */
export async function playNightTones(cues: readonly NightCue[], end: number): Promise<boolean> {
  const p = nightAudio();
  if (!p) return false;
  hook(p);
  const list = nightCuesAhead(cues, Date.now());
  if (!list.length || end <= Date.now()) return false;
  try { await p.start({ cues: list, end }); return true; } catch { return false; }
}

/** Whether the service is playing a schedule just now (a screen coming back must not replace it by mistake). */
export async function nightTonesRunning(): Promise<boolean> {
  const p = nightAudio();
  if (!p) return false;
  try { return !!(await p.status()).running; } catch { return false; }
}

/** Stops the tones; the count played. */
export async function stopNightTones(): Promise<number> {
  const p = nightAudio();
  if (!p) return 0;
  try { return (await p.stop()).played || 0; } catch { return 0; }
}

/** Called when the service stops by itself or from its notification's Stop. Returns the unsubscribe. */
export function onNightTonesEnded(f: (played: number) => void): () => void {
  subs.add(f);
  return () => { subs.delete(f); };
}
