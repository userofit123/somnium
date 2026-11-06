// What the Somnium screens can ask of the desktop app: accounts, backups to a folder, and updates.
import { contextBridge, ipcRenderer } from "electron";

let onProgress: ((p: number, bytes?: number) => void) | null = null;
ipcRenderer.on("update:progress", (_e, p: number, bytes?: number) => onProgress?.(p, bytes));
// a page the app asks the screens to open (a click on the update notification)
let onOpen: ((path: string) => void) | null = null;
ipcRenderer.on("app:open", (_e, path: string) => onOpen?.(path));

// Electron prefixes a failed ipcRenderer.invoke with "Error invoking remote method 'x': Error: ".
// Strip it here so every page that shows the error gets just the message the main process wrote.
const accountCall = (channel: string, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(channel, ...args).catch((e: Error) => {
    throw new Error(String(e.message).replace(/^Error invoking remote method[^:]*: (Error: )?/, ""));
  });

const api = {
  platform: "desktop",
  onOpen: (cb: (path: string) => void) => { onOpen = cb; },
  accounts: {
    list: () => accountCall("accounts:list"),
    current: () => accountCall("accounts:current"),
    addLocal: (name: string) => accountCall("accounts:addLocal", name),
    addServer: (url: string, name: string) => accountCall("accounts:addServer", url, name),
    open: (id: string) => accountCall("accounts:open", id),
    rename: (id: string, name: string) => accountCall("accounts:rename", id, name),
    remove: (id: string) => accountCall("accounts:remove", id),
    chooser: () => accountCall("accounts:chooser"),
    // a local account's keys (LDJ-53): the envelope only, never the data key
    keys: () => accountCall("accounts:keys"),
    setKeys: (keys: unknown) => accountCall("accounts:setKeys", keys),
    compact: () => accountCall("accounts:compact"),
  },
  privacy: {
    // Electron's content protection is a request to the system, and Linux has nothing to ask
    canAskSystem: process.platform !== "linux",
    screenshotsAllowed: () => ipcRenderer.invoke("privacy:screenshots"),
    setScreenshotsAllowed: (allow: boolean) => ipcRenderer.invoke("privacy:setScreenshots", allow),
  },
  // reality check reminders: the page sends the plan (times and words), the main process shows them (main.ts)
  reminders: { setPlan: (items: { at: number; title: string; body: string; url: string }[]) => ipcRenderer.invoke("reminders:setPlan", items) },
  saveBackup: (name: string, bytes: Uint8Array, keep: number) => ipcRenderer.invoke("backup:save", name, bytes, keep),
  backupFolder: () => ipcRenderer.invoke("backup:folder"),
  chooseBackupFolder: () => ipcRenderer.invoke("backup:choose"),
  openBackupFolder: () => ipcRenderer.invoke("backup:open"),
  update: {
    version: () => ipcRenderer.invoke("update:version"),
    check: () => ipcRenderer.invoke("update:check"),
    download: (cb: (p: number, bytes?: number) => void) => { onProgress = cb; return ipcRenderer.invoke("update:download"); },
    install: () => ipcRenderer.invoke("update:install"),
    metered: () => ipcRenderer.invoke("update:metered"),
  },
};
contextBridge.exposeInMainWorld("somniumNative", api);
contextBridge.exposeInMainWorld("somniumDesktop", true);
