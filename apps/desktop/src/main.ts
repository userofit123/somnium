// The Somnium desktop app (PLAN.md §2.4). Each account is either:
//  - local: Somnium's own server runs inside the app with PGlite, keeping everything on this computer;
//  - server: the app's own screens, with the data on your Somnium server (its API is proxied).
// Accounts live side by side, each in its own browser partition (cookies, cache) and, for local ones, its own database.
import { app, BrowserWindow, ipcMain, dialog, shell, session as eSession, Menu, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { checkServerAddress, cleanName, normaliseStore, type AccountEntry, type AccountStore, type ServerEntry, type SyncNote } from "@somnium/shared";

/** keys: a local account's password and recovery envelope (LocalKeys in @somnium/shared): useless without the password
 *  or the recovery key, kept with the account and gone with it. */
/** prefs: what the screens keep for this account that must not depend on its address (KEPT_PREFS). */
interface Account extends AccountEntry { port?: number; keys?: unknown; prefs?: Record<string, string> }
type Store = AccountStore<Account>;
// what the screens may see of an account: never another account's keys
const shown = ({ keys, prefs, ...a }: Account) => a;
const USER = app.getPath("userData");
const ACCOUNTS = path.join(USER, "accounts.json");
const RES = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../..");
const WEB = app.isPackaged ? path.join(RES, "web") : path.join(RES, "apps/web/dist");

// servers: the saved servers with the names the person gave them (plain settings, not journal content; PLAN.md §6.7).
// A file from before servers had names gets one per address, named as its account was.
const readAccounts = (): Store => { let raw: unknown = null; try { raw = JSON.parse(fs.readFileSync(ACCOUNTS, "utf8")); } catch { /* none yet */ } return normaliseStore<Account>(raw, () => crypto.randomUUID()); };
// The file holds the local accounts' key envelopes: readable by this user only. writeFileSync's mode applies only when
// it creates the file, so a new file is written (any leftover one removed first) and renamed over the old one, which
// also means a crash mid-write never leaves half a file; chmod then makes sure, whatever the umask or an older file was.
const writeAccounts = (a: Store) => {
  fs.mkdirSync(USER, { recursive: true });
  const tmp = ACCOUNTS + ".tmp";
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(tmp, JSON.stringify(a, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, ACCOUNTS);
  fs.chmodSync(ACCOUNTS, 0o600);
};
// an accounts file written by an older version may be readable by others: tightened at start
try { if (fs.existsSync(ACCOUNTS)) fs.chmodSync(ACCOUNTS, 0o600); } catch { /* rewritten with the right mode on the next change */ }

let win: BrowserWindow | null = null;
let running: { id: string; port: number; close: () => Promise<void>; compact?: () => Promise<void> } | null = null;

// ----- local accounts: the Somnium server inside the app -----
async function startLocal(acc: Account): Promise<{ port: number; close: () => Promise<void>; compact: () => Promise<void>; token: string }> {
  const dir = path.join(USER, "accounts", acc.id);
  fs.mkdirSync(dir, { recursive: true });
  const { pgliteDb } = await import("@somnium/engine/pglite");
  const { buildApp, localSession } = await import("@somnium/server/src/app");
  const db = await pgliteDb(path.join(dir, "db"));
  // sealed at rest like a server (LDJ-53): the screens seal every sealed column before it gets here, and the server's
  // rules refuse one in the clear
  const { app: srv, engine } = await buildApp({ db, dataDir: dir, webDir: WEB, logger: false, mode: "server" });
  // the same address every time, as for a server account (startProxy): the screens keep things in the browser storage
  // of that address (an unsaved dream's words, the look, the backup log). Only if that port is taken does it move.
  // What must not reset with the address (the lock's wrong tries) is kept in the account's record (KEPT_PREFS).
  try { await srv.listen({ host: "127.0.0.1", port: acc.port ?? 0 }); }
  catch (e) { if (!acc.port) throw e; await srv.listen({ host: "127.0.0.1", port: 0 }); }
  const port = (srv.server.address() as any).port;
  const token = await localSession(db, acc.name);
  return { port, token, close: async () => { await srv.close(); await db.close(); }, compact: () => engine.compact() };
}

// ----- server accounts: local screens, the API proxied to the server -----
function startProxy(acc: Account): Promise<{ port: number; close: () => Promise<void> }> {
  const target = new URL(acc.url!);
  const lib = target.protocol === "https:" ? https : http;
  const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".json": "application/json" };
  const serveFile = (root: string, rel: string, res: http.ServerResponse) => {
    const f = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return false;
    res.writeHead(200, { "content-type": mime[path.extname(f)] ?? "application/octet-stream", "cache-control": rel.startsWith("assets/") ? "max-age=31536000, immutable" : "no-cache" });
    fs.createReadStream(f).pipe(res);
    return true;
  };
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    let clean = url.split("?")[0]!;
    try { clean = decodeURIComponent(clean); } catch { /* left as it came */ }
    if (url.startsWith("/api/")) {
      const headers = { ...req.headers, host: target.host, origin: target.origin };
      const p = lib.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, path: url, method: req.method, headers }, (r) => {
        const h = { ...r.headers };
        // cookies come back for this app's own address: drop the server's domain and "Secure" (the local address is plain http)
        if (h["set-cookie"]) h["set-cookie"] = h["set-cookie"].map((c) => c.replace(/;\s*Domain=[^;]+/i, "").replace(/;\s*Secure/i, ""));
        res.writeHead(r.statusCode ?? 502, h);
        r.pipe(res);
      });
      p.on("error", () => { if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Can't reach your Somnium server" })); });
      req.pipe(p);
      return;
    }
    if (clean !== "/" && serveFile(WEB, clean.slice(1), res)) return;
    serveFile(WEB, "index.html", res);
  });
  // the same address every time: the screens keep this account's offline copy in the browser storage of that address
  const done = (resolve: (v: { port: number; close: () => Promise<void> }) => void) => () => resolve({ port: (server.address() as any).port, close: () => new Promise((r) => server.close(() => r())) });
  return new Promise((resolve) => {
    server.once("error", () => server.listen(0, "127.0.0.1", done(resolve)));
    server.listen(acc.port ?? 0, "127.0.0.1", done(resolve));
  });
}

async function openAccount(id: string) {
  const all = readAccounts();
  const acc = all.list.find((a) => a.id === id);
  if (!acc) return showChooser();
  if (running) { await running.close().catch(() => {}); running = null; }
  const part = eSession.fromPartition(`persist:acct-${acc.id}`);
  let port: number;
  if (acc.kind === "local") {
    const s = await startLocal(acc);
    port = s.port;
    await part.cookies.set({ url: `http://127.0.0.1:${port}`, name: "somnium_session", value: s.token, httpOnly: true, expirationDate: Date.now() / 1000 + 3600 * 24 * 365 });
    running = { id, port, close: s.close, compact: s.compact };
  } else {
    const s = await startProxy(acc);
    port = s.port;
    running = { id, port, close: s.close };
  }
  if (acc.port !== port) { acc.port = port; const i = all.list.findIndex((x) => x.id === acc.id); all.list[i] = acc; }
  writeAccounts({ ...all, active: id });
  const next = makeWindow(part);
  await next.loadURL(`http://127.0.0.1:${port}/`);
  if (win && win !== next) win.destroy();
  win = next;
}

// Screenshots and screen sharing show a blank window unless the person allows them (PLAN.md §4.3). Electron does this on
// Windows and macOS; it has no effect on Linux. The setting is kept per computer: a screenshot is a matter of this machine.
const ALLOW_SCREENSHOTS = path.join(USER, "allow-screenshots.txt");
const screenshotsAllowed = () => fs.existsSync(ALLOW_SCREENSHOTS);

// LDJ-10: unlocking with the device isn't built here. WebAuthn refuses the app's http://127.0.0.1 address, and
// safeStorage alone is not verification: it decrypts for anyone using the signed-in computer, without asking for
// anything (and on Linux it may have no real keyring behind it, see safeStorage.getSelectedStorageBackend). Keeping the data key
// in it would make the lock screen's button open the journal for whoever clicks. It needs a real prompt in front of it
// (systemPreferences.promptTouchID on macOS, Windows Hello on Windows). Until then the desktop app unlocks with the password.
function makeWindow(part?: Electron.Session) {
  const w = new BrowserWindow({
    width: 1400, height: 900, minWidth: 380, minHeight: 600, backgroundColor: "#17100d", show: false, autoHideMenuBar: true, title: "Somnium",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), session: part, contextIsolation: true, sandbox: false },
  });
  w.setContentProtection(!screenshotsAllowed());
  w.once("ready-to-show", () => w.show());
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  return w;
}

function showChooser() {
  const w = makeWindow();
  w.loadFile(path.join(__dirname, "accounts.html")).catch(() => w.loadURL("data:text/html,Somnium"));
  if (win) win.destroy();
  win = w;
}

// ----- what the screens can ask of the app (window.somniumNative, see preload.ts) -----
ipcMain.handle("privacy:screenshots", () => screenshotsAllowed());
ipcMain.handle("privacy:setScreenshots", (_e, allow: unknown) => {
  if (allow === true) fs.writeFileSync(ALLOW_SCREENSHOTS, "");
  else fs.rmSync(ALLOW_SCREENSHOTS, { force: true });
  for (const w of BrowserWindow.getAllWindows()) w.setContentProtection(allow !== true);
  return allow === true;
});
ipcMain.handle("accounts:list", () => { const a = readAccounts(); return { ...a, list: a.list.map(shown) }; });
ipcMain.handle("accounts:addLocal", async (_e, name: unknown) => { const a = readAccounts(); const acc: Account = { id: crypto.randomUUID(), kind: "local", name: cleanName(name) || "Me" }; a.list.push(acc); writeAccounts(a); await openAccount(acc.id); });
/** Checks a Somnium server answers at an address (its /api/version names its API level). https, or http on this
 *  computer or a private network (the screens warned about it first). It gets a few seconds: an address that never
 *  answers would otherwise leave the screen waiting for minutes. */
async function checkServer(input: unknown): Promise<string> {
  const c = checkServerAddress(typeof input === "string" ? input : "");
  if (!c.ok) throw new Error(c.error);
  const res = await fetch(c.origin + "/api/version", { signal: AbortSignal.timeout(8000) }).catch((e) => {
    if (e?.name === "TimeoutError") throw new Error("No answer from that address in 8 seconds. Check the address and that the server is running.");
    const code = e?.cause?.code ?? "";
    if (/CERT|SSL|TLS/i.test(code)) throw new Error("That server's certificate isn't trusted by this computer");
    throw new Error("Couldn't reach that address. Check it, and that this computer is on a network that can reach the server.");
  });
  const j: { apiLevel?: unknown } | null = res.ok ? await res.json().catch(() => null) : null;
  if (typeof j?.apiLevel !== "number") throw new Error("Something answered at that address, but it isn't a Somnium server");
  return c.origin;
}
ipcMain.handle("accounts:addServer", async (_e, url: unknown, name: unknown) => {
  const base = await checkServer(url);
  const a = readAccounts();
  const had = a.servers.find((s) => s.url === base);
  if (had) throw new Error(`That server is already saved as ${had.name}. To use another account on it, choose "Add an account" in its menu.`);
  const s: ServerEntry = { id: crypto.randomUUID(), name: cleanName(name) || new URL(base).host, url: base };
  const acc: Account = { id: crypto.randomUUID(), kind: "server", name: s.name, serverId: s.id, url: base };
  a.servers.push(s); a.list.push(acc); writeAccounts(a); await openAccount(acc.id);
});
// another account on a saved server: its own partition and proxy, so its sign-in is its own; it opens on the sign-in screen
ipcMain.handle("accounts:addAccount", async (_e, serverId: unknown) => {
  const a = readAccounts(); const s = a.servers.find((x) => x.id === serverId);
  if (!s) throw new Error("That server isn't saved here");
  const acc: Account = { id: crypto.randomUUID(), kind: "server", name: s.name, serverId: s.id, url: s.url };
  a.list.push(acc); writeAccounts(a); await openAccount(acc.id);
});
ipcMain.handle("accounts:open", (_e, id: string) => openAccount(id));
ipcMain.handle("accounts:rename", (_e, id: string, name: unknown) => {
  const a = readAccounts(); const acc = a.list.find((x) => x.id === id), n = cleanName(name);
  if (acc && n) { acc.name = n; writeAccounts(a); }
});
ipcMain.handle("accounts:renameServer", (_e, id: string, name: unknown) => {
  const a = readAccounts(); const s = a.servers.find((x) => x.id === id), n = cleanName(name);
  if (s && n) { s.name = n; writeAccounts(a); }
});
// a server that moved: its accounts follow it. Each keeps its partition and port, so its copy here stays its own.
ipcMain.handle("accounts:setServerAddress", async (_e, id: string, url: unknown) => {
  const base = await checkServer(url);
  const a = readAccounts(); const s = a.servers.find((x) => x.id === id);
  if (!s || s.url === base) return;
  if (a.servers.some((x) => x.url === base && x.id !== id)) throw new Error("Another saved server has that address");
  s.url = base;
  for (const acc of a.list) if (acc.serverId === id) acc.url = base;
  writeAccounts(a);
  if (a.list.some((x) => x.serverId === id && x.id === running?.id)) await openAccount(running!.id);
});
// who is signed in on the open account and how its sync is going, from its own screens: shown while another is open
ipcMain.handle("accounts:setStatus", (_e, st: { user?: { id: string; username: string } | null; sync?: SyncNote }) => {
  const a = readAccounts(); const acc = a.list.find((x) => x.id === a.active && x.id === running?.id);
  if (!acc || !st || typeof st !== "object") return;
  if (st.user !== undefined && acc.kind === "server") acc.user = typeof st.user?.username === "string" ? st.user.username.slice(0, 60) : undefined;
  const n = st.sync;
  if (n && typeof n === "object" && typeof n.state === "string" && ["synced", "waiting", "offline", "locked", "local", "signedOut"].includes(n.state))
    acc.sync = { state: n.state, pending: Math.max(0, Number(n.pending) | 0), at: Number(n.at) || Date.now() };
  writeAccounts(a);
});
ipcMain.handle("accounts:chooser", () => showChooser());
// asked: the screens already asked, naming what is lost (removePlan in @somnium/shared); the chooser page asks here
async function dropAccount(a: Store, acc: Account) {
  if (running?.id === acc.id) { await running.close(); running = null; }
  if (acc.kind === "local") fs.rmSync(path.join(USER, "accounts", acc.id), { recursive: true, force: true });
  await eSession.fromPartition(`persist:acct-${acc.id}`).clearStorageData();
  a.list = a.list.filter((x) => x.id !== acc.id);
}
ipcMain.handle("accounts:remove", async (_e, id: string, asked?: boolean) => {
  const a = readAccounts();
  const acc = a.list.find((x) => x.id === id);
  if (!acc) return;
  if (asked !== true) {
    const r = await dialog.showMessageBox(win!, { type: "warning", buttons: ["Cancel", "Remove"], defaultId: 0, message: `Remove ${acc.user || acc.name} from this computer?`, detail: acc.kind === "local" ? "Its data on this computer is deleted. Make a backup first if you want to keep it." : "Your data stays on the server. Changes not sent to it yet are lost." });
    if (r.response !== 1) return;
  }
  await dropAccount(a, acc);
  // removing another account from Settings keeps the open one open; only removing the open one goes back to the chooser
  const wasOpen = a.active === id;
  writeAccounts({ ...a, active: wasOpen ? null : a.active });
  if (wasOpen) showChooser();
});
ipcMain.handle("accounts:removeServer", async (_e, id: string) => {
  const a = readAccounts();
  if (!a.servers.some((s) => s.id === id)) return;
  const wasOpen = a.list.some((x) => x.serverId === id && x.id === a.active);
  for (const acc of a.list.filter((x) => x.serverId === id)) await dropAccount(a, acc);
  writeAccounts({ ...a, servers: a.servers.filter((s) => s.id !== id), active: wasOpen ? null : a.active });
  if (wasOpen) showChooser();
});
ipcMain.handle("accounts:current", () => { const a = readAccounts(); const acc = a.list.find((x) => x.id === a.active); return acc ? shown(acc) : null; });
// The open local account's keys (LDJ-53). Only the account that is running: its screens are the only ones that can ask.
const openLocal = () => { const a = readAccounts(); const acc = a.list.find((x) => x.id === a.active && x.id === running?.id); return acc?.kind === "local" ? { a, acc } : null; };
ipcMain.handle("accounts:keys", () => openLocal()?.acc.keys ?? null);
ipcMain.handle("accounts:setKeys", (_e, keys: unknown) => {
  const o = openLocal();
  if (!o) throw new Error("Not a local account");
  // only the envelope's short text fields: the screens check the shape (localKeysFrom), this keeps the file small and plain
  if (!keys || typeof keys !== "object" || JSON.stringify(keys).length > 4000) throw new Error("Those keys don't look right");
  o.acc.keys = Object.fromEntries(Object.entries(keys as Record<string, unknown>).filter(([, v]) => v === null || typeof v === "string"));
  writeAccounts(o.a);
});
ipcMain.handle("accounts:compact", () => running?.compact?.());

// What the screens keep for the open account that must survive a restart and not depend on its address (a port taken
// by something else moves the account to another one, and with it the browser storage): the lock's wrong-try count and
// the lock's settings. Kept in the account's record, beside its keys. Synchronous (sendSync), as the screens read them
// while starting. Only the open account's own window may ask: it is told apart by its browser partition.
const KEPT_PREFS = new Set(["somniumLockTries", "somniumLock"]);
const prefsAccount = (e: Electron.IpcMainEvent) => {
  if (!running || e.sender.session !== eSession.fromPartition(`persist:acct-${running.id}`)) return null;
  const a = readAccounts(); const acc = a.list.find((x) => x.id === running!.id);
  return acc ? { a, acc } : null;
};
ipcMain.on("prefs:get", (e, k: unknown) => {
  e.returnValue = null;
  try { if (typeof k === "string" && KEPT_PREFS.has(k)) e.returnValue = prefsAccount(e)?.acc.prefs?.[k] ?? null; } catch { /* null: the screens use their own */ }
});
ipcMain.on("prefs:set", (e, k: unknown, v: unknown) => {
  e.returnValue = false;
  try {
    if (typeof k !== "string" || !KEPT_PREFS.has(k) || (v !== null && (typeof v !== "string" || v.length > 2000))) return;
    const o = prefsAccount(e);
    if (!o) return;
    const prefs = { ...o.acc.prefs };
    if (v === null) delete prefs[k]; else prefs[k] = v;
    o.acc.prefs = prefs;
    writeAccounts(o.a);
    e.returnValue = true;
  } catch { /* not kept: the screens keep their own copy */ }
});

const backupDir = () => { const f = path.join(USER, "backup-folder.txt"); try { return fs.readFileSync(f, "utf8").trim(); } catch { return path.join(app.getPath("documents"), "Somnium Backups"); } };
ipcMain.handle("backup:folder", () => backupDir());
ipcMain.handle("backup:choose", async () => { const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"], defaultPath: backupDir() }); if (r.canceled || !r.filePaths[0]) return null; fs.writeFileSync(path.join(USER, "backup-folder.txt"), r.filePaths[0]); return r.filePaths[0]; });
ipcMain.handle("backup:save", (_e, name: string, bytes: Uint8Array, keep: number) => {
  const dir = backupDir(); fs.mkdirSync(dir, { recursive: true });
  const acc = readAccounts().list.find((a) => a.id === readAccounts().active);
  const file = path.join(dir, (acc ? acc.name.replace(/[^\w.-]+/g, "_") + "-" : "") + path.basename(name));
  fs.writeFileSync(file + ".tmp", Buffer.from(bytes)); fs.renameSync(file + ".tmp", file);
  const mine = fs.readdirSync(dir).filter((f) => f.endsWith(".somniumbackup") && (!acc || f.startsWith(acc.name.replace(/[^\w.-]+/g, "_") + "-"))).sort().reverse();
  for (const old of mine.slice(Math.max(1, keep))) fs.rmSync(path.join(dir, old), { force: true });
  return file;
});
ipcMain.handle("backup:open", () => shell.openPath(backupDir()));

// ----- updates from GitHub Releases -----
// the screens decide when to check and download (Settings, App & Versions: automatic checks, downloads, Only on
// Wi-Fi); a download only ever ends in "ready to install", and only the person's Install installs it, never a quit
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
// the download also shows on the taskbar / dock icon. With the size unknown, a value above 1 is a moving bar only on
// Windows; macOS and Linux would draw it full, as if done, so there it stays off until the size is known (-1 clears it)
autoUpdater.on("download-progress", (p) => {
  win?.setProgressBar(p.total > 0 ? p.percent / 100 : process.platform === "win32" ? 2 : -1);
  win?.webContents.send("update:progress", p.total > 0 ? p.percent / 100 : -1, p.transferred);
});
// held here: a notification that is garbage-collected loses its click
let updateNotice: Notification | null = null;
/** When it's done or failed, a system notification if Somnium isn't in front (in front, the page already says so); a
 *  click brings the window back on Settings, App & Versions, where Install is. */
function updateDone(title: string, body: string) {
  win?.setProgressBar(-1);
  if (!Notification.isSupported() || win?.isFocused()) return;
  updateNotice = new Notification({ title, body, icon: path.join(__dirname, "icon.png") });
  updateNotice.on("click", () => { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.webContents.send("app:open", "/settings/versions"); });
  updateNotice.show();
}
ipcMain.handle("update:version", () => app.getVersion());
ipcMain.handle("update:check", async () => { try { const r = await autoUpdater.checkForUpdates(); return r?.updateInfo?.version ?? null; } catch { return null; } });
ipcMain.handle("update:download", async () => {
  try { await autoUpdater.checkForUpdates(); await autoUpdater.downloadUpdate(); }
  catch (e) { updateDone("Update failed", "The download didn't finish. Click to try again."); throw e; }
  updateDone("Update ready to install", "Click to open App & Versions, then Install");
  return true;
});
ipcMain.handle("update:install", () => autoUpdater.quitAndInstall());
// whether the connection is metered, for Only on Wi-Fi: Windows knows it as the network's cost (a connection set as
// metered, or mobile data), Linux through NetworkManager's own Metered (set or guessed, e.g. a phone's hotspot);
// macOS can't be asked without native code. `known` says whether the answer means anything, so the app hides the
// switch where it could never do anything (macOS, Linux without NetworkManager/gdbus)
ipcMain.handle("update:metered", () => new Promise<{ metered: boolean; known: boolean }>((done) => {
  const ask = (cmd: string, args: string[], known: RegExp, metered: RegExp) =>
    execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, out) => {
      const s = String(out);
      done({ metered: !err && metered.test(s), known: !err && known.test(s) });
    });
  if (process.platform === "win32") ask("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "[void][Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]; " +
    "$p = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile(); if ($p) { $p.GetConnectionCost().NetworkCostType }"],
    /Unrestricted|Fixed|Variable/, /Fixed|Variable/);
  // NMMetered: 1 yes, 3 guessed yes (0 unknown, 2 no, 4 guessed no)
  else if (process.platform === "linux") ask("gdbus", ["call", "--system", "--dest", "org.freedesktop.NetworkManager", "--object-path", "/org/freedesktop/NetworkManager",
    "--method", "org.freedesktop.DBus.Properties.Get", "org.freedesktop.NetworkManager", "Metered"],
    /uint32 [1-4]\b/, /uint32 [13]\b/);
  else done({ metered: false, known: false });
}));

// ----- reality check reminders (PLAN.md §9) -----
// The page works out the plan (packages/shared/src/reminders.ts, the same for every device) and sends it here with the
// words; the main process keeps the timers, so a reminder comes while the window is minimised, hidden or behind others.
// Closing the window quits the app (as Motus does: no tray), and with it the reminders. A tap brings the window back on
// /check, which opens over the lock screen and logs the check. Only what the page sends is shown: the question and the
// check's own instruction (plus the top dream sign's name if the person turned that on).
let rcTimers: ReturnType<typeof setTimeout>[] = [];
const rcShown = new Set<Notification>(); // held: a notification that is garbage-collected loses its click
const LATE = 15 * 60_000, AHEAD = 3 * 86_400_000;
function showReminder(r: { at: number; title: string; body: string; url: string }) {
  if (!Notification.isSupported() || Date.now() - r.at > LATE) return; // the computer slept through it: skipped, not late
  const n = new Notification({ title: r.title, body: r.body, icon: path.join(__dirname, "icon.png") });
  n.on("click", () => { rcShown.delete(n); if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.webContents.send("app:open", r.url); });
  n.on("close", () => rcShown.delete(n));
  rcShown.add(n);
  n.show();
}
ipcMain.handle("reminders:setPlan", (_e, items: unknown) => {
  for (const t of rcTimers) clearTimeout(t);
  rcTimers = [];
  if (!Array.isArray(items)) return 0;
  const now = Date.now();
  for (const it of items.slice(0, 200)) {
    if (!it || typeof it.at !== "number" || typeof it.title !== "string" || typeof it.body !== "string" || typeof it.url !== "string") continue;
    if (!it.url.startsWith("/check") || it.at < now - 60_000 || it.at > now + AHEAD) continue;
    const r = { at: it.at, title: it.title.slice(0, 200), body: it.body.slice(0, 400), url: it.url };
    rcTimers.push(setTimeout(() => showReminder(r), Math.max(0, r.at - now)));
  }
  return rcTimers.length;
});

app.setAppUserModelId("org.somnium.app");
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const a = readAccounts();
  if (a.active && a.list.some((x) => x.id === a.active)) await openAccount(a.active).catch(() => showChooser());
  else showChooser();
});
app.on("window-all-closed", async () => { if (running) await running.close().catch(() => {}); app.quit(); });
