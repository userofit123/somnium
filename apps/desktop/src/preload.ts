// What the Somnium screens can ask of the desktop app: accounts, backups to a folder, updates, reminders and the tray.
import { contextBridge, ipcRenderer } from "electron";

let onProgress: ((p: number, bytes?: number) => void) | null = null;
ipcRenderer.on("update:progress", (_e, p: number, bytes?: number) => onProgress?.(p, bytes));
// a page the app asks the screens to open (a click on the update notification)
let onOpen: ((path: string) => void) | null = null;
ipcRenderer.on("app:open", (_e, path: string) => onOpen?.(path));
// the window was closed to the tray: the screens lock at once (core/lock.ts)
let onHidden: (() => void) | null = null;
ipcRenderer.on("app:hidden", () => onHidden?.());
// "Pause reminders today" / "Resume reminders" from the tray: the screens save it in the schedule (native/reminders.ts)
let onPause: ((on: boolean) => void) | null = null;
ipcRenderer.on("reminders:pause", (_e, on: boolean) => onPause?.(on === true));

// Electron prefixes a failed ipcRenderer.invoke with "Error invoking remote method 'x': Error: ".
// Strip it here so every page that shows the error gets just the message the main process wrote.
const accountCall = (channel: string, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(channel, ...args).catch((e: Error) => {
    throw new Error(String(e.message).replace(/^Error invoking remote method[^:]*: (Error: )?/, ""));
  });

const api = {
  platform: "desktop",
  onOpen: (cb: (path: string) => void) => { onOpen = cb; },
  onHidden: (cb: () => void) => { onHidden = cb; },
  // a guided timer is running: nothing about an update interrupts it (main.ts guidedBusy)
  setBusy: (busy: boolean) => ipcRenderer.invoke("app:busy", busy === true),
  // this computer's own settings (Settings → Notifications): close to the tray, start at login
  desktop: {
    settings: (): Promise<{ closeToTray: boolean; trayAvailable: boolean; openAtLogin: boolean }> => ipcRenderer.invoke("desktop:settings"),
    setCloseToTray: (on: boolean) => ipcRenderer.invoke("desktop:setCloseToTray", on),
    setOpenAtLogin: (on: boolean) => ipcRenderer.invoke("desktop:setOpenAtLogin", on),
  },
  accounts: {
    list: () => accountCall("accounts:list"),
    current: () => accountCall("accounts:current"),
    addLocal: (name: string) => accountCall("accounts:addLocal", name),
    addServer: (url: string, name: string) => accountCall("accounts:addServer", url, name),
    open: (id: string) => accountCall("accounts:open", id),
    addAccount: (serverId: string) => accountCall("accounts:addAccount", serverId),
    rename: (id: string, name: string) => accountCall("accounts:rename", id, name),
    renameServer: (id: string, name: string) => accountCall("accounts:renameServer", id, name),
    setServerAddress: (id: string, url: string) => accountCall("accounts:setServerAddress", id, url),
    setStatus: (st: unknown) => accountCall("accounts:setStatus", st),
    // the chooser page's remove asks in the app; Settings asks first and says so
    remove: (id: string) => accountCall("accounts:remove", id),
    removeAccount: (id: string) => accountCall("accounts:remove", id, true),
    removeServer: (id: string) => accountCall("accounts:removeServer", id),
    device: "computer",
    // plain http to this computer or a home network is allowed here (with a warning); Android blocks it
    insecureAllowed: true,
    chooser: () => accountCall("accounts:chooser"),
    // a local account's keys (LDJ-53): the envelope only, never the data key
    keys: () => accountCall("accounts:keys"),
    setKeys: (keys: unknown) => accountCall("accounts:setKeys", keys),
    compact: () => accountCall("accounts:compact"),
  },
  // what the screens keep for this account that must not reset with a restart or a new address (main.ts KEPT_PREFS):
  // values as JSON text, null when there is none. Synchronous, as the lock reads its count while starting.
  prefs: {
    get: (k: string): string | null => ipcRenderer.sendSync("prefs:get", k),
    set: (k: string, v: string | null): boolean => ipcRenderer.sendSync("prefs:set", k, v),
  },
  privacy: {
    // Electron's content protection is a request to the system, and Linux has nothing to ask
    canAskSystem: process.platform !== "linux",
    screenshotsAllowed: () => ipcRenderer.invoke("privacy:screenshots"),
    setScreenshotsAllowed: (allow: boolean) => ipcRenderer.invoke("privacy:setScreenshots", allow),
  },
  // reality check reminders: the page sends the plan (times and words), the main process shows them (main.ts)
  reminders: {
    setPlan: (items: { at: number; title: string; body: string; url: string; silent?: boolean }[]) => ipcRenderer.invoke("reminders:setPlan", items),
    onPause: (cb: (on: boolean) => void) => { onPause = cb; },
  },
  // the optional local text model: the main process keeps the address (per account) and makes the one call to it
  // (main.ts localModel:set and localModel:call); the screens never name the address in a call
  localModel: {
    get: (): Promise<{ url: string; model: string; ack: boolean } | null> => accountCall("localModel:get"),
    set: (v: { url: string; model: string; ack: boolean }): Promise<{ url: string; model: string; ack: boolean } | null> => accountCall("localModel:set", v),
    call: (path: string, body?: unknown): Promise<any> => accountCall("localModel:call", path, body),
  },
  saveBackup: (name: string, bytes: Uint8Array, keep: number) => ipcRenderer.invoke("backup:save", name, bytes, keep),
  backupFolder: () => ipcRenderer.invoke("backup:folder"),
  chooseBackupFolder: () => ipcRenderer.invoke("backup:choose"),
  openBackupFolder: () => ipcRenderer.invoke("backup:open"),
  update: {
    version: () => ipcRenderer.invoke("update:version"),
    check: () => ipcRenderer.invoke("update:check"),
    download: (cb: (p: number, bytes?: number) => void) => { onProgress = cb; return ipcRenderer.invoke("update:download"); },
    install: () => accountCall("update:install"),
    staged: () => ipcRenderer.invoke("update:staged"),
    forget: () => ipcRenderer.invoke("update:forget"),
    metered: () => ipcRenderer.invoke("update:metered"),
  },
};
contextBridge.exposeInMainWorld("somniumNative", api);
contextBridge.exposeInMainWorld("somniumDesktop", true);
