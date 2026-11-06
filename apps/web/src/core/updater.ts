// In-app updates for the installed apps. The desktop app (Electron) and the Android app (Capacitor) each provide
// window.somniumNative.update; in a browser there is nothing to install (the page simply loads the new version).
import { reactive, watch, onBeforeUnmount } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useMe, useSettings } from "../api/queries";
import { latestRelease, detectPlatform, newer } from "./releases";

const nat = () => (globalThis as any).somniumNative?.update;
export const updater = reactive({
  appVersion: "" as string,
  status: "" as string,
  ready: false,
  // the version of the downloaded file that is ready (so Install names what it installs, also offline after a restart)
  stagedVersion: "" as string,
  // the newest release, kept here by the App & Versions screen: a download for another version is then not the one to install
  latest: "" as string,
  // share downloaded (0-1) while a download runs; null when idle or when the size is unknown
  progress: null as number | null,
  // a download is running: a second tap would start a second download of the same file
  downloading: false,
  // whether this device can tell a metered connection (Android always; a computer only where the system can be asked):
  // Only on Wi-Fi shows only then, as elsewhere it would do nothing
  canTellMetered: false,
  async install() {
    const u = nat(); if (!u || updater.downloading) return;
    try {
      if (!updater.ready) {
        updater.downloading = true; updater.status = "Downloading"; updater.progress = null;
        // p < 0 means the size is unknown: show the megabytes so far instead of a percentage
        const got = await u.download((p: number, bytes?: number) => {
          updater.progress = p >= 0 ? p : null;
          updater.status = p >= 0 ? `Downloading ${Math.round(p * 100)}%` : bytes ? `Downloading ${(bytes / 1e6).toFixed(1)} MB` : "Downloading";
        });
        updater.progress = null; updater.ready = true;
        updater.stagedVersion = typeof got === "string" && got ? got : updater.latest;
        updater.status = `Ready to install${updater.stagedVersion ? " " + updater.stagedVersion : ""}`;
      }
      else await u.install();
    } catch (e) { updater.progress = null; updater.status = (e as Error).message; }
    finally { updater.downloading = false; }
  },
  // the ready file is out of date (a newer release exists): forget it, and delete it where the app can, so the next
  // tap downloads the newer one
  forget() {
    if (updater.downloading) return;
    updater.ready = false; updater.stagedVersion = ""; updater.status = ""; updater.progress = null;
    try { nat()?.forget?.()?.catch?.(() => {}); } catch { /* nothing to delete */ }
  },
});
// what the app knows from the start: its version, and a download that finished before the app was closed (Android
// keeps the file and remembers it), which is offered as Install, not another download, as the "ready to install"
// notification promises. Started on first use, not at import: the Android app's bridge appears only once the page runs.
let started: Promise<unknown> | null = null;
// whether the app can tell mobile data apart; asked again at every look until it can, because it can answer "unknown"
// only because the network was down at that moment (Windows offline, NetworkManager not up yet)
function askMetered(): Promise<unknown> {
  return Promise.resolve(nat()?.metered?.()).then((m: { known?: boolean } | undefined) => (updater.canTellMetered = !!m?.known)).catch(() => {});
}
export function startUpdater(): Promise<unknown> {
  const u = nat();
  if (!u) return Promise.resolve();
  return (started ??= Promise.all([
    u.version?.().then((v: string) => (updater.appVersion = v)).catch?.(() => {}),
    askMetered(),
    u.staged?.().then((v: string | null) => {
      if (v && !updater.ready && !updater.downloading) { updater.ready = true; updater.stagedVersion = v; updater.status = `Ready to install ${v}`; }
    }).catch?.(() => {}),
  ]));
}
startUpdater();

// Automatic updates in the apps (Settings, App & Versions). "Check for updates automatically": on start and then every
// 6 hours (PLAN.md §12.3), never otherwise (only Check now). "Download updates automatically": what such a check finds is
// downloaded in the background and left ready to install; installing is always the person's tap. "Only on Wi-Fi": that
// download waits while the connection is metered (mobile data); the check itself is a few kilobytes and doesn't wait.
const CHECK_EVERY = 6 * 3600_000;
// how often to look whether a check is due or a waiting download can start (a phone back on Wi-Fi)
const TICK = 15 * 60_000;
let lastCheck = 0;
// after a failed check or download, nothing is tried again before this much time has passed (GitHub's rate limits)
const RETRY_GAP = 15 * 60_000;
let lastFail = 0;
// the newer version the last automatic check found and that isn't downloaded yet
let pending = "";
let busy = false;

/** Runs the automatic checks and downloads while a signed-in screen is open; the shells call it. */
export function useAutoUpdate() {
  void startUpdater();
  if (!detectPlatform().app) return;
  const me = useMe(), s = useSettings(), qc = useQueryClient();
  const tick = async () => {
    const u = s.value.updates;
    // until the person's settings have arrived, the defaults would speak for them
    if (!me.data.value || !u.autoCheck || busy) return;
    busy = true;
    try {
      await startUpdater();
      if (!updater.canTellMetered) await askMetered();
      if (Date.now() - lastCheck >= CHECK_EVERY && Date.now() - lastFail >= RETRY_GAP) {
        // the same answer App & Versions shows (its "Checked at" follows); a check that failed (offline) is tried
        // again after RETRY_GAP, not 6 hours later
        const r = await qc.fetchQuery({ queryKey: ["static", "release"], queryFn: latestRelease, staleTime: 0 }).catch(() => null);
        const v = r?.latest ?? "";
        if (!v) { lastFail = Date.now(); return; }
        lastCheck = Date.now(); lastFail = 0;
        updater.latest = v;
        pending = updater.appVersion && newer(v, updater.appVersion) && !(updater.ready && updater.stagedVersion === v) ? v : "";
      }
      if (!pending || !u.autoDownload || updater.downloading || Date.now() - lastFail < RETRY_GAP) return;
      if (u.wifiOnly && (await nat()?.metered?.().catch(() => null))?.metered) return;
      // a ready download of an older release gives way to the newer one
      if (updater.ready && updater.stagedVersion !== pending) updater.forget();
      // pending stays until the file is really downloaded, so a failed download is tried again (after the gap)
      if (!updater.ready) await updater.install();
      if (updater.ready) { pending = ""; lastFail = 0; } else lastFail = Date.now();
    } finally { busy = false; }
  };
  const run = () => { void tick(); };
  const timer = setInterval(run, TICK);
  const onShow = () => { if (document.visibilityState === "visible") run(); };
  document.addEventListener("visibilitychange", onShow);
  window.addEventListener("online", run);
  // at the start (once the settings are in), and when a switch is turned on
  watch(() => [!!me.data.value, s.value.updates.autoCheck, s.value.updates.autoDownload, s.value.updates.wifiOnly], run, { immediate: true });
  onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener("visibilitychange", onShow); window.removeEventListener("online", run); });
}
