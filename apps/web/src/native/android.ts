// Inside the Android app (Capacitor): accounts, backups to a folder on the phone, the in-app updater, the system bars'
// colours, and the back button. Exposed as window.somniumNative, like the desktop app.
import { accounts, addLocal, addServer, addAccount, open, remove, removeAccount, removeServer, rename, renameServer, setServerAddress, setStatus, chooser, localKeys, setLocalKeys, compactLocal, current, deviceBlob, setDeviceBlob, forgetDeviceBlobsOf } from "./accounts";
import { BACKUP_NAME, backupsPastKeep, looksLikeBackup } from "@somnium/shared";
import { sheetIsOpen, closeTopSheet } from "../core/sheets";
import { REPO, newer, fetchWithin } from "../core/releases";
import { applyTheme } from "../core/theme";
import { router } from "../router";
import { notificationState, askNotificationPermission } from "./notifications";
import { nativeAway, nativeBack } from "../core/lock";

const cap = () => (globalThis as any).Capacitor;
const P = (n: string) => cap()?.Plugins?.[n];
export const isAndroid = () => cap()?.getPlatform?.() === "android";

async function latestApk() {
  const r = await fetchWithin(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error("Could not reach GitHub");
  const j = await r.json();
  const manifest = j.assets?.find((a: any) => a.name === "android-latest.json");
  const meta = manifest ? await (await fetchWithin(manifest.browser_download_url)).json() : null;
  const apk = j.assets?.find((a: any) => a.name.endsWith(".apk"));
  return { version: String(j.tag_name).replace(/^v/, ""), url: meta?.url ?? apk?.browser_download_url, sha256: meta?.sha256 ?? null, notes: j.body ?? "", html: j.html_url };
}

// The phone's own verification (SomniumLockPlugin, LDJ-9): the data key wrapped by a Keystore key that only works after
// the fingerprint, face or screen lock. The wrapped blob is kept in the open account's record. Errors come back named
// for the lock screen: NotAllowedError for a cancelled prompt (never counted), SealError when the blob didn't open
// (counted like a wrong password), DeviceNotice with a message to show (locked out for now, or the key ended because
// the phone's screen lock or fingerprints changed: then the blob is dropped and the password is the way in).
const LOCK = () => P("SomniumLock");
const named = (name: string, message: string) => Object.assign(new Error(message), { name });
function lockError(e: any): Error {
  const code = e?.code, message = String(e?.message ?? e ?? "");
  if (code === "cancelled") return named("NotAllowedError", "Verification was cancelled");
  if (code === "wrong") return named("SealError", "This phone couldn't open your journal");
  if (code === "invalidated") { try { setDeviceBlob(null); } catch {} return named("DeviceNotice", message); }
  if (code === "lockout" || code === "unavailable") return named("DeviceNotice", message);
  return named("Error", message || "This phone couldn't use its key");
}
const accountId = () => { const id = current()?.id; if (!id) throw new Error("No account is open"); return id; };
const deviceLock = {
  async available(): Promise<boolean> { return !!(await LOCK()?.available?.().catch(() => null))?.available; },
  has: () => !!deviceBlob(),
  /** dataKey and the answer: base64url. The data key is only in the plugin's hands for the call. */
  async wrap(dataKey: string): Promise<void> {
    let r; try { r = await LOCK().wrap({ id: accountId(), dataKey }); } catch (e) { throw lockError(e); }
    setDeviceBlob(r.blob);
  },
  async unwrap(): Promise<string> {
    const blob = deviceBlob();
    if (!blob) throw named("DeviceNotice", "This phone doesn't hold your key any more. Use your password.");
    try { return (await LOCK().unwrap({ id: accountId(), blob })).dataKey; } catch (e) { throw lockError(e); }
  },
  async forget(): Promise<void> { if (current()) setDeviceBlob(null); },
  forgetFor: forgetDeviceBlobsOf,
};

export function installAndroidBridge() {
  if (!isAndroid()) return;
  const info = P("App")?.getInfo?.();
  let staged: string | null = null;
  (globalThis as any).somniumNative = {
    platform: "android",
    deviceLock,
    // FLAG_SECURE, on unless allowed here: Android enforces it (screenshots, screen recording and the recents thumbnail)
    privacy: {
      canAskSystem: true,
      screenshotsAllowed: async () => !!(await LOCK()?.screenshotsAllowed?.().catch(() => null))?.allowed,
      setScreenshotsAllowed: async (allowed: boolean) => !!(await LOCK()?.setScreenshotsAllowed?.({ allowed }))?.allowed,
    },
    accounts: {
      // what the screens may see: never a token or another account's keys
      list: async () => ({ list: accounts.list.map(({ token, keys, deviceKey, ...a }) => a), active: accounts.active, servers: accounts.servers.map((s) => ({ ...s })) }),
      current: async () => { const a = accounts.list.find((x) => x.id === accounts.active); if (!a) return null; const { keys, token, deviceKey, ...rest } = a; return rest; },
      addLocal, addServer, addAccount, open, remove, removeAccount, removeServer, rename, renameServer, setServerAddress, setStatus, chooser,
      device: "phone", insecureAllowed: false,
      keys: localKeys, setKeys: setLocalKeys, compact: compactLocal,
    },
    // backups go to Documents/Somnium on the phone (the Filesystem plugin), named for the account (as on the desktop),
    // and its newest `keep` are kept. That folder is shared with anything else on the phone: only files with this app's
    // name and its format inside are ever deleted, and only this account's.
    async saveBackup(name: string, bytes: Uint8Array, keep: number) {
      const fs = P("Filesystem");
      const a = current(), prefix = a ? a.name.replace(/[^\w.-]+/g, "_") + "-" : "";
      const file = `${prefix}${name}`;
      let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      await fs.writeFile({ path: `Somnium/${file}`, data: btoa(bin), directory: "DOCUMENTS", recursive: true });
      const list = (await fs.readdir({ path: "Somnium", directory: "DOCUMENTS" })).files.map((f: any) => String(f.name ?? f));
      for (const old of backupsPastKeep(list, keep, prefix)) {
        const head = await fs.readFile({ path: `Somnium/${old}`, directory: "DOCUMENTS", encoding: "utf8" }).then((r: any) => String(r.data ?? "").slice(0, 200)).catch(() => "");
        if (looksLikeBackup(head)) await fs.deleteFile({ path: `Somnium/${old}`, directory: "DOCUMENTS" }).catch(() => {});
      }
      return `Documents/Somnium/${file}`;
    },
    // a backup made across an account switch: the file is not kept (core/backup.ts backupNow)
    async discardBackup(where: string) {
      const m = /^Documents\/Somnium\/([^/]+)$/.exec(where);
      if (m && BACKUP_NAME.test(m[1]!)) await P("Filesystem").deleteFile({ path: `Somnium/${m[1]}`, directory: "DOCUMENTS" }).catch(() => {});
    },
    backupFolder: async () => "Documents/Somnium",
    update: {
      version: async () => (await info)?.version ?? "",
      async check() { const l = await latestApk(); const cur = (await info)?.version ?? "0"; return { current: cur, latest: l.version, newer: newer(l.version, cur), notes: l.notes, url: l.html }; },
      // download the APK, check its SHA-256, then hand it to Android's installer (one tap to confirm, Android's rule)
      async download(onProgress: (p: number, bytes?: number) => void) {
        const l = await latestApk();
        // Android 13+ shows the download's notification only once allowed: ask now if it was never asked; a "no"
        // changes nothing, the download runs without it
        if ((await notificationState()) === "prompt") await askNotificationPermission();
        // p is the share done (0-1), or -1 when the size is unknown
        const h = await P("SomniumUpdater").addListener("progress", ({ loaded, total }: { loaded: number; total: number }) => onProgress(total > 0 ? loaded / total : -1, loaded));
        let res;
        try { res = await P("SomniumUpdater").download({ url: l.url, sha256: l.sha256, version: l.version }); } finally { h?.remove?.(); }
        onProgress(1);
        staged = res.path;
        return l.version as string;
      },
      // a newer release replaced the one that was ready: its file is deleted
      async forget() { staged = null; await P("SomniumUpdater")?.discard?.().catch(() => {}); },
      async install() { if (staged) await P("SomniumUpdater").install({ path: staged }); },
      // mobile data or another metered connection: "Only on Wi-Fi" downloads wait
      // Android can always tell
      async metered(): Promise<{ metered: boolean; known: boolean }> { return { metered: !!(await P("SomniumUpdater")?.metered?.().catch(() => null))?.metered, known: true }; },
      // an update downloaded before the app was last closed, still ready to install: its version, or null
      async staged(): Promise<string | null> {
        const r = await P("SomniumUpdater")?.staged?.().catch(() => null);
        if (!r?.path || !r.version) return null;
        staged = r.path;
        return r.version;
      },
    },
  };
  // the hardware back button closes an open sheet, goes back in the app, and leaves it from the home page
  // a tap on the update download's notification names a page (App & Versions): open it
  // only a page of this app, reduced to its path and query: "//elsewhere" starts with "/" too
  P("SomniumUpdater")?.addListener?.("open", ({ path }: { path?: string }) => { const p = typeof path === "string" ? appPath(path) : null; if (p) void router.push(p); });
  // leaving the app and coming back, from the activity itself (SomniumLockPlugin): the page's lock waits out the delay
  // from the moment the app began to leave. The page's own visibility events say the same, so nothing is counted twice.
  P("SomniumLock")?.addListener?.("away", ({ at }: { at?: number }) => nativeAway(typeof at === "number" ? at : Date.now()));
  P("SomniumLock")?.addListener?.("back", () => nativeBack());
  P("App")?.addListener?.("backButton", ({ canGoBack }: { canGoBack: boolean }) => { if (sheetIsOpen()) closeTopSheet(); else if (canGoBack && location.pathname !== "/") history.back(); else P("App").minimizeApp?.(); });
  // the page runs behind clear status and navigation bars (SomniumBarsPlugin), so its own background shows under the
  // clock and beside a side bar; it pads itself by the bars' sizes (--nst / --nsb / --nsl / --nsr, used by --st / --sb /
  // --sl / --sr in tokens.css)
  const pad = ({ top, bottom, left = 0, right = 0 }: { top: number; bottom: number; left?: number; right?: number }) => {
    const r = document.documentElement.style;
    r.setProperty("--nst", top + "px"); r.setProperty("--nsb", bottom + "px"); r.setProperty("--nsl", left + "px"); r.setProperty("--nsr", right + "px");
  };
  P("SomniumBars")?.addListener?.("insets", pad);
  P("SomniumBars")?.insets?.().then(pad, () => {});
  // the clock and icons follow the look, dark or light (theme.ts calls somniumApp.setBars); phones before Android 6 also
  // colour the bars with it. Android reads only #rrggbb, so a short "#abc" is spelled out
  (globalThis as any).somniumApp = {
    setBars: (bg: string, dark: boolean) => {
      const c = /^#[0-9a-f]{3}$/i.test(bg) ? "#" + [...bg.slice(1)].map((x) => x + x).join("") : bg;
      P("SomniumBars")?.set?.({ bg: c, dark }).catch?.(() => {});
    },
  };
  // the look was put on the page before this bridge existed (main.ts starts the theme first), so the bars missed it:
  // give them the current one now
  applyTheme();
}

/** A page of this app from an address a notification handed over: its path and query on this origin, else null. */
export function appPath(u: string): string | null {
  try { const x = new URL(u, location.origin); return x.origin === location.origin ? x.pathname + x.search : null; } catch { return null; }
}
