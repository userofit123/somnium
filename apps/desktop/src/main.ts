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

interface Account { id: string; kind: "local" | "server"; name: string; url?: string; port?: number }
const USER = app.getPath("userData");
const ACCOUNTS = path.join(USER, "accounts.json");
const RES = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../..");
const WEB = app.isPackaged ? path.join(RES, "web") : path.join(RES, "apps/web/dist");

const readAccounts = (): { list: Account[]; active: string | null } => { try { return JSON.parse(fs.readFileSync(ACCOUNTS, "utf8")); } catch { return { list: [], active: null }; } };
const writeAccounts = (a: { list: Account[]; active: string | null }) => { fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(ACCOUNTS, JSON.stringify(a, null, 2)); };

let win: BrowserWindow | null = null;
let running: { id: string; port: number; close: () => Promise<void> } | null = null;

// ----- local accounts: the Somnium server inside the app -----
async function startLocal(acc: Account): Promise<{ port: number; close: () => Promise<void>; token: string }> {
  const dir = path.join(USER, "accounts", acc.id);
  fs.mkdirSync(dir, { recursive: true });
  const { pgliteDb } = await import("@somnium/engine/pglite");
  const { buildApp, localSession } = await import("@somnium/server/src/app");
  const db = await pgliteDb(path.join(dir, "db"));
  const { app: srv } = await buildApp({ db, dataDir: dir, webDir: WEB, logger: false });
  await srv.listen({ host: "127.0.0.1", port: 0 });
  const port = (srv.server.address() as any).port;
  const token = await localSession(db, acc.name);
  return { port, token, close: async () => { await srv.close(); await db.close(); } };
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
    running = { id, port, close: s.close };
  } else {
    const s = await startProxy(acc);
    port = s.port;
    if (acc.port !== port) { acc.port = port; const i = all.list.findIndex((x) => x.id === acc.id); all.list[i] = acc; }
    running = { id, port, close: s.close };
  }
  writeAccounts({ ...all, active: id });
  const next = makeWindow(part);
  await next.loadURL(`http://127.0.0.1:${port}/`);
  if (win && win !== next) win.destroy();
  win = next;
}

function makeWindow(part?: Electron.Session) {
  const w = new BrowserWindow({
    width: 1400, height: 900, minWidth: 380, minHeight: 600, backgroundColor: "#17100d", show: false, autoHideMenuBar: true, title: "Somnium",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), session: part, contextIsolation: true, sandbox: false },
  });
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
ipcMain.handle("accounts:list", () => readAccounts());
ipcMain.handle("accounts:addLocal", async (_e, name: string) => { const a = readAccounts(); const acc: Account = { id: crypto.randomUUID(), kind: "local", name: name || "Me" }; a.list.push(acc); writeAccounts(a); await openAccount(acc.id); });
/** "somnium.home", "192.168.1.5:8080" or "https://Somnium.Example.com/x/" → "https://somnium.home" (https unless told otherwise). Same rules as the Android app (apps/web/src/native/accounts.ts). */
function serverAddress(input: string) {
  const s = input.trim();
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); if (/^https?:$/.test(u.protocol) && u.hostname) return u.origin; } catch { /* not an address */ }
  throw new Error("That doesn't look like an address");
}
ipcMain.handle("accounts:addServer", async (_e, url: unknown, name: unknown) => {
  if (typeof url !== "string") throw new Error("That doesn't look like an address");
  const base = serverAddress(url);
  // https only, like the Android app: sign-in and your data never travel unencrypted
  if (base.startsWith("http://")) throw new Error("This app only connects over https. Use the https address of your server.");
  // a Somnium server answers its sign-in status with its API level; anything else at that address isn't one.
  // It gets a few seconds: an address that never answers would otherwise leave the screen waiting for minutes.
  const res = await fetch(base + "/api/auth/status", { signal: AbortSignal.timeout(8000) }).catch((e) => { if (e?.name === "TimeoutError") throw new Error("No answer from that address"); return null; });
  const j: { apiLevel?: unknown } | null = res?.ok ? await res.json().catch(() => null) : null;
  if (typeof j?.apiLevel !== "number") throw new Error("No Somnium server answered at that address");
  const a = readAccounts();
  if (a.list.some((x) => x.url === base)) throw new Error("That server is already in the list");
  const label = typeof name === "string" ? name.trim().slice(0, 60) : "";
  const acc: Account = { id: crypto.randomUUID(), kind: "server", name: label || new URL(base).host, url: base }; a.list.push(acc); writeAccounts(a); await openAccount(acc.id);
});
ipcMain.handle("accounts:open", (_e, id: string) => openAccount(id));
ipcMain.handle("accounts:rename", (_e, id: string, name: string) => {
  const a = readAccounts(); const acc = a.list.find((x) => x.id === id);
  if (acc && String(name).trim()) { acc.name = String(name).trim().slice(0, 60); writeAccounts(a); }
});
ipcMain.handle("accounts:chooser", () => showChooser());
ipcMain.handle("accounts:remove", async (_e, id: string) => {
  const a = readAccounts();
  const acc = a.list.find((x) => x.id === id);
  if (!acc) return;
  const r = await dialog.showMessageBox(win!, { type: "warning", buttons: ["Cancel", "Remove"], defaultId: 0, message: `Remove ${acc.name} from this computer?`, detail: acc.kind === "local" ? "Its data on this computer is deleted. Make a backup first if you want to keep it." : "Your data stays on the server." });
  if (r.response !== 1) return;
  if (running?.id === id) { await running.close(); running = null; }
  if (acc.kind === "local") fs.rmSync(path.join(USER, "accounts", id), { recursive: true, force: true });
  await eSession.fromPartition(`persist:acct-${id}`).clearStorageData();
  // removing another account from Settings keeps the open one open; only removing the open one goes back to the chooser
  const wasOpen = a.active === id;
  writeAccounts({ list: a.list.filter((x) => x.id !== id), active: wasOpen ? null : a.active });
  if (wasOpen) showChooser();
});
ipcMain.handle("accounts:current", () => { const a = readAccounts(); return a.list.find((x) => x.id === a.active) ?? null; });

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
