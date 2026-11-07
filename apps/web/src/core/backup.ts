// Backups to this device (PLAN.md §12, LDJ-35). A .somniumbackup file is JSON: the journal sealed exactly as on the
// server (each sealed column an envelope bound to its row, under the data key) plus the account's wrapped data key,
// so it opens with the password or the recovery key and nothing else (packages/engine/src/sync/backupFile.ts). Plain
// columns (dates, ratings) are readable in it, as they are on the server; an optional passphrase wraps the whole file.
//
// Making one needs the journal open on this device: the device's copy holds plaintext (its replica, a local account
// opened through the transport), so every row is sealed here with the key, which only exists while unlocked. That is
// also when the app is in use, so automatic backups run then: the desktop app writes to a folder (Documents/Somnium
// Backups by default), the Android app to Documents/Somnium, a Chromium browser into a folder picked once; any other
// browser can't write files on its own, so it offers a download when one is due.
import { api } from "../api/client";
import { SealError, backupsPastKeep, looksLikeBackup } from "@somnium/shared";
import { invalidate } from "../api/live";
import {
  BACKUP_LOCKED_FORMAT, lockBackupFile, makeBackupFile, openBackupKey, openExport, parseBackupFile, unlockBackupFile,
  type BackupAccount, type BackupFile,
} from "@somnium/engine/sealed-api";
import { keyring } from "./keyring";
import { localKeys } from "./localLock";
import { saved } from "./accounts";
import { readJson, writeJson } from "./prefs";
import { toast } from "./toast";
import { session } from "./session";
import { choose, confirm, prompt } from "./ask";

/** A direct export leaves out rows that didn't open (sealedApi.ts): only the number is said, nothing of what they hold. */
export function tellLeftOut(data: any) {
  const n = Number(data?.unopened) || 0;
  if (n) toast(`${n} row${n === 1 ? "" : "s"} couldn't be opened and ${n === 1 ? "was" : "were"} left out`);
}

/** The account's wrapped keys: a local account's own record, or what the server keeps (the same values it hands out). */
async function accountBlock(): Promise<BackupAccount> {
  const local = saved.list.find((a) => a.id === saved.active)?.kind === "local";
  if (local) {
    const k = await localKeys();
    if (!k) throw new Error("This account has no password yet, so a backup couldn't be opened again");
    return { kdfSalt: k.salt, wrappedByPassword: k.wrappedByPassword, recoverySalt: k.recoverySalt, wrappedByRecovery: k.wrappedByRecovery };
  }
  const b = await api.get<{ kdfSalt: string; wrappedByPassword: string | null; recoverySalt?: string | null; wrappedByRecovery?: string | null }>("/auth/bundle");
  if (!b.wrappedByPassword) throw new Error("Set a new password first: the account's key isn't wrapped by one right now");
  return { kdfSalt: b.kdfSalt, wrappedByPassword: b.wrappedByPassword, recoverySalt: b.recoverySalt, wrappedByRecovery: b.wrappedByRecovery };
}

/** The backup file. Needs the journal open here; passphrase: the optional extra wrap of the whole file. */
export async function makeBackup(passphrase?: string): Promise<Blob> {
  if (!keyring.isOpen()) throw new Error("Unlock Somnium to make a backup");
  const plain = await api.get("/export");
  tellLeftOut(plain);
  const account = await accountBlock();
  const key = keyring.get();
  if (!key) throw new Error("Unlock Somnium to make a backup");
  let file: object;
  try { file = await makeBackupFile(plain, key, account); } finally { key.fill(0); }
  if (passphrase) file = await lockBackupFile(file as BackupFile, passphrase);
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

const owner = () => `${saved.active ?? ""}|${session.user?.id ?? ""}`;
export const backupName = (d = new Date()) => `somnium-backup-${d.toISOString().slice(0, 16).replace(/[T:]/g, "-")}.somniumbackup`;
export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ----- the log (the Security checklist reads lastAt) -----
export interface BackupLog { lastAt: string | null; lastName: string | null; size: number | null; where: string | null; error: string | null }
export const backupLog = (): BackupLog => ({ lastAt: null, lastName: null, size: null, where: null, error: null, ...readJson<Partial<BackupLog>>("somniumBackupLog", {}) });
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
const nativeSave = () => (globalThis as any).somniumNative?.saveBackup as ((n: string, b: Uint8Array, keep: number) => Promise<unknown>) | undefined;
export const canPickFolder = () => typeof (window as any).showDirectoryPicker === "function";
export async function pickFolder(): Promise<string | null> {
  const h = await (window as any).showDirectoryPicker({ id: "somnium-backups", mode: "readwrite" });
  await idb((s) => s.put(h, "dir"), "readwrite");
  return h.name;
}
export async function folderName(): Promise<string | null> { try { return (await idb<any>((s) => s.get("dir")))?.name ?? null; } catch { return null; } }
/** Whether backups can be written without asking: the apps' folder, or a picked folder still allowed. */
export async function canBackUpSilently(): Promise<boolean> {
  if (nativeSave()) return true;
  const h = await idb<any>((s) => s.get("dir")).catch(() => null);
  return !!h && (await h.queryPermission?.({ mode: "readwrite" }).catch(() => "denied")) === "granted";
}

/** Writes a backup now: into the apps' folder or the chosen one (keeping the newest `keep`), or as a download. */
export async function backupNow(o: { passphrase?: string; keep?: number; interactive?: boolean } = {}): Promise<string> {
  // whose backup this is: an account switched (or someone else signed in) while it was being made means the file is
  // not written, or not kept, under the account now open
  const who = owner(), moved = () => owner() !== who;
  const switched = () => new Error("The account changed while the backup was being made. It wasn't kept.");
  try {
    const blob = await makeBackup(o.passphrase);
    if (moved()) throw switched();
    const name = backupName();
    let where: string;
    const save = nativeSave();
    if (save) {
      const written = await save(name, new Uint8Array(await blob.arrayBuffer()), o.keep ?? 7);
      if (moved()) { await (globalThis as any).somniumNative?.discardBackup?.(written).catch(() => {}); throw switched(); }
      where = (await (globalThis as any).somniumNative?.backupFolder?.().catch(() => null)) ?? "the app's backup folder";
    } else {
      const h = await idb<any>((s) => s.get("dir")).catch(() => null);
      let perm = h ? await h.queryPermission?.({ mode: "readwrite" }).catch(() => "denied") : "denied";
      if (h && perm !== "granted" && o.interactive !== false) perm = await h.requestPermission?.({ mode: "readwrite" }).catch(() => "denied");
      if (h && perm === "granted") {
        const f = await h.getFileHandle(name, { create: true });
        const w = await f.createWritable(); await w.write(blob); await w.close();
        if (moved()) { await h.removeEntry(name).catch(() => {}); throw switched(); }
        // only this app's own backups go (its name, and its format inside): never another .somniumbackup in the folder
        const names: string[] = [];
        for await (const [n] of h.entries()) names.push(String(n));
        for (const old of backupsPastKeep(names, o.keep ?? 7)) {
          const head = await (await h.getFileHandle(old)).getFile().then((f: Blob) => f.slice(0, 200).text()).catch(() => "");
          if (looksLikeBackup(head)) await h.removeEntry(old);
        }
        where = `Folder: ${h.name}`;
      } else if (o.interactive !== false) { download(blob, name); where = "Downloaded"; }
      else throw new Error("This browser can't save backups on its own. Pick a folder, or download one.");
    }
    setLog({ lastAt: new Date().toISOString(), lastName: name, size: blob.size, where, error: null });
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
let running = false;
/** Runs an automatic backup when one is due and the journal is open: silently where it can, else offers a download. */
export async function maybeAutoBackup(cfg: { on: boolean; every: "daily" | "weekly"; keep: number }, offer?: (run: () => void) => void) {
  if (running || !backupDue(cfg) || !keyring.isOpen()) return;
  running = true;
  try {
    // the extra passphrase can't be asked for unseen, so automatic backups rely on the account's own sealing
    if (await canBackUpSilently()) await backupNow({ keep: cfg.keep, interactive: false }).catch(() => { /* shown in Settings → Backup */ });
    else if (!offered) { offered = true; offer?.(() => { backupNow({ keep: cfg.keep, interactive: true }).catch(() => {}); }); }
  } finally { running = false; }
}

/** Checks for a due backup now, whenever the journal is unlocked, and every hour while the app is open. */
let started = false;
export function startAutoBackups(cfg: () => { on: boolean; every: "daily" | "weekly"; keep: number } | null, offer: (run: () => void) => void) {
  if (started) return; started = true;
  const tick = () => { const c = cfg(); if (c) maybeAutoBackup(c, offer); };
  setTimeout(tick, 4000);
  keyring.onChange((open) => { if (open) setTimeout(tick, 4000); });
  setInterval(tick, 3600000);
}

// ----- restoring -----
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Restores a .somniumbackup or a Somnium JSON export: a preview answered on the device, the password or recovery key
 * for a backup, then merge (add what's missing, newest wins) or replace (asked twice; the account and its keys stay).
 * The rows are opened here with the backup's key and sealed again by the transport under this account's key, so a
 * backup restores into a local account, a server account or a different account alike.
 */
export async function restoreFromFile(file: Blob, fmt: { date: (s: string) => string }): Promise<boolean> {
  let parsed = parseBackupFile(await file.text());
  if (parsed.format === BACKUP_LOCKED_FORMAT) {
    const pass = await prompt("This backup has a passphrase", { text: "Enter the passphrase it was saved with.", secret: true, autocomplete: "current-password" });
    if (!pass) return false;
    try { parsed = await unlockBackupFile(parsed, pass); } catch (e) { if (e instanceof SealError) throw new Error("Wrong passphrase"); throw e; }
  }
  const sealedData = parsed.format === "export" ? parsed.data : (parsed as BackupFile).data;
  const pv = await api.post<{ exportedAt: string; counts: Record<string, number>; from: string | null; to: string | null }>("/import/preview", { data: sealedData });
  const c = pv.counts;
  const lines = [
    [c.dreams ? plural(c.dreams, "dream") : "", c.nights ? plural(c.nights, "night") : "", c.reality_checks ? plural(c.reality_checks, "reality check") : "", c.practice_log ? `${c.practice_log} practice` : ""].filter(Boolean).join(" · ") || "Settings only",
    pv.from ? `${fmt.date(pv.from)} - ${fmt.date(pv.to!)}` : "",
    pv.exportedAt ? `Made ${fmt.date(pv.exportedAt)}` : "",
  ].filter(Boolean).join("\n");
  const mode = await choose("Restore this backup?", [
    { label: "Merge: add what's missing, the newest version of each entry wins", value: "merge" },
    { label: "Replace: make the journal exactly like the backup", value: "replace" },
  ], lines);
  if (mode !== "merge" && mode !== "replace") return false;
  let data = sealedData;
  if (parsed.format !== "export" || sealedData.sealed) {
    if (parsed.format === "export") throw new Error("This export holds the journal sealed without its key. Restore a .somniumbackup instead.");
    const secret = await prompt("Password or recovery key", { text: "The account's password when the backup was made, or its recovery key.", secret: true, autocomplete: "current-password" });
    if (!secret) return false;
    const key = await openBackupKey(parsed as BackupFile, secret).catch((e) => { throw e instanceof SealError ? new Error(e.message) : e; });
    try { const o = await openExport(sealedData, key); data = o.data; tellLeftOut({ unopened: o.unopened }); } finally { key.fill(0); }
  }
  if (mode === "replace") {
    if (!(await confirm("Replace your journal?", { text: "Everything in it now is removed and the backup's entries take its place. Your account, password and recovery key stay.", ok: "Continue", danger: true }))) return false;
    if (!(await confirm("Really replace everything?", { text: "This can't be undone. A backup of what you have now is saved first.", ok: "Replace", danger: true }))) return false;
    await backupNow({ interactive: true });
  }
  const counts = await api.post<Record<string, number>>("/import", { data, mode });
  invalidate(["*"]);
  toast(`Restored · ${plural(counts.dreams ?? 0, "dream")} · ${plural(counts.nights ?? 0, "night")}`);
  return true;
}
