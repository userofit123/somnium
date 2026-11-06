// Backups to this device (requirement 20): a .somniumbackup file is gzip-compressed JSON of everything you have,
// optionally encrypted with a password (AES-GCM, key from PBKDF2). Format: "MOTB" + version byte + flag byte + body.
// Automatic backups: the desktop and Android apps write to a folder you choose; in a browser that supports it
// (Chrome, Edge) Somnium writes into a folder you pick once; elsewhere it offers the file to download when one is due.
import { api } from "../api/client";
import { readJson, writeJson } from "./prefs";

const MAGIC = [0x4d, 0x4f, 0x54, 0x42]; // MOTB
const enc = new TextEncoder(), dec = new TextDecoder();

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function key(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function makeBackup(password?: string): Promise<Blob> {
  const data = await api.get("/export");
  const body = await gzip(enc.encode(JSON.stringify(data)));
  if (!password) return new Blob([new Uint8Array([...MAGIC, 1, 0]), body], { type: "application/octet-stream" });
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(password, salt), body));
  return new Blob([new Uint8Array([...MAGIC, 1, 1]), salt, iv, ct], { type: "application/octet-stream" });
}

/** Reads a .somniumbackup (or a plain .json export). Asks for the password through the callback when needed. */
export async function readBackup(file: Blob, askPassword: () => Promise<string | null>): Promise<any> {
  const b = new Uint8Array(await file.arrayBuffer());
  if (b[0] === 0x7b) return JSON.parse(dec.decode(b)); // a JSON export
  if (!MAGIC.every((m, i) => b[i] === m)) throw new Error("This is not a Somnium backup");
  let body = b.slice(6);
  if (b[5] === 1) {
    const pw = await askPassword();
    if (!pw) throw new Error("A password is needed for this backup");
    const salt = body.slice(0, 16), iv = body.slice(16, 28), ct = body.slice(28);
    try { body = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(pw, salt), ct)); } catch { throw new Error("Wrong password"); }
  }
  return JSON.parse(dec.decode(await gunzip(body)));
}

export const backupName = (d = new Date()) => `somnium-backup-${d.toISOString().slice(0, 16).replace(/[T:]/g, "-")}.somniumbackup`;
export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ----- automatic backups -----
export interface BackupLog { lastAt: string | null; lastName: string | null; error: string | null }
export const backupLog = (): BackupLog => readJson("somniumBackupLog", { lastAt: null, lastName: null, error: null });
const setLog = (l: Partial<BackupLog>) => writeJson("somniumBackupLog", { ...backupLog(), ...l });

/** A folder handle kept in IndexedDB (File System Access API, Chromium browsers). */
const DB = "somnium-backup";
function idb<T>(fn: (s: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode = "readonly"): Promise<T> {
  return new Promise((res, rej) => {
    const o = indexedDB.open(DB, 1);
    o.onupgradeneeded = () => o.result.createObjectStore("kv");
    o.onsuccess = () => { const r = fn(o.result.transaction("kv", mode).objectStore("kv")); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); };
    o.onerror = () => rej(o.error);
  });
}
export const canPickFolder = () => typeof (window as any).showDirectoryPicker === "function";
export async function pickFolder(): Promise<string | null> {
  const h = await (window as any).showDirectoryPicker({ id: "somnium-backups", mode: "readwrite" });
  await idb((s) => s.put(h, "dir"), "readwrite");
  return h.name;
}
export async function folderName(): Promise<string | null> { try { return (await idb<any>((s) => s.get("dir")))?.name ?? null; } catch { return null; } }

/** Writes a backup now: into the chosen folder (keeping the newest `keep`), or as a download. */
export async function backupNow(o: { password?: string; keep?: number; interactive?: boolean } = {}): Promise<string> {
  const blob = await makeBackup(o.password);
  const name = backupName();
  const native = (globalThis as any).somniumNative?.saveBackup;
  try {
    if (native) { await native(name, new Uint8Array(await blob.arrayBuffer()), o.keep ?? 14); }
    else {
      const h = await idb<any>((s) => s.get("dir")).catch(() => null);
      if (h && (await h.queryPermission?.({ mode: "readwrite" })) === "granted") {
        const f = await h.getFileHandle(name, { create: true });
        const w = await f.createWritable(); await w.write(blob); await w.close();
        const names: string[] = [];
        for await (const [n] of h.entries()) if (String(n).endsWith(".somniumbackup")) names.push(String(n));
        for (const old of names.sort().reverse().slice(o.keep ?? 14)) await h.removeEntry(old);
      } else if (o.interactive !== false) download(blob, name);
      else throw new Error("Pick a backup folder in Settings → Backup");
    }
    setLog({ lastAt: new Date().toISOString(), lastName: name, error: null });
    return name;
  } catch (e) { setLog({ error: (e as Error).message }); throw e; }
}

/** True when an automatic backup is due under the person's settings. */
export function backupDue(cfg: { on: boolean; every: "daily" | "weekly" }): boolean {
  if (!cfg.on) return false;
  const last = backupLog().lastAt ? new Date(backupLog().lastAt!).getTime() : 0;
  return Date.now() - last > (cfg.every === "daily" ? 86400000 : 7 * 86400000) - 3600000;
}

let offered = false; // the download is offered once per visit
/** Runs an automatic backup when one is due: silently into the folder (or the app's folder), else offers a download. */
export async function maybeAutoBackup(cfg: { on: boolean; every: "daily" | "weekly"; keep: number; encrypt: boolean }, offer?: (run: () => void) => void) {
  if (!backupDue(cfg) || cfg.encrypt) return; // encrypted backups need the password, so they are made by hand
  const silent = !!(globalThis as any).somniumNative?.saveBackup || ((await idb<any>((s) => s.get("dir")).catch(() => null)) && true);
  if (silent) { try { await backupNow({ keep: cfg.keep, interactive: false }); } catch { /* shown in Settings → Backup */ } }
  // in a plain browser the data already lives on the server, so a daily "download your backup" would only nag;
  // backups there are made by hand (or into a picked folder), and the apps keep theirs on the device
  else if (!offered && (globalThis as any).Capacitor?.isNativePlatform?.()) { offered = true; offer?.(() => backupNow({ keep: cfg.keep, interactive: true })); }
}
