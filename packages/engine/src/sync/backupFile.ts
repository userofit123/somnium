// The .somniumbackup file (PLAN.md §12, LDJ-35). Plain JSON:
//
//   { format: "somnium-backup", version: 1, createdAt,
//     account: { kdfSalt, wrappedByPassword, recoverySalt?, wrappedByRecovery? },
//     data: <a sealed export: GET /export as the server holds it> }
//
// The journal stays sealed exactly as on the server: every sealed column is an envelope bound to its table, column and
// row id, under the account's data key. The account block is the same wrapped data key the server keeps, so the file
// opens with the password the account had when it was made, or with its recovery key, and with nothing else. No second
// passphrase is needed. What is readable without a key: the plain columns (dates, times, ratings, yes-or-no marks),
// the settings and the user name, exactly what the server itself can read.
//
// For anyone who wants those hidden too, the whole file can be wrapped once more with a passphrase:
//
//   { format: "somnium-backup-locked", version: 1, createdAt, kdf: { name: "argon2id", salt, memoryKiB, iterations },
//     sealed: "v1.<iv>.<AES-256-GCM of the JSON above>" }
//
// The key for that wrap is Argon2id(passphrase, salt) with the app's parameters (packages/shared/src/crypto/kdf.ts).
import {
  ARGON2, SealError, argon2, fromBase64url, fromUtf8, newSalt, openWithPassword, openWithRecoveryKey, sealBytes, toBase64url, unsealBytes, utf8,
} from "@somnium/shared";
import { sealRows, unsealRows, type Row } from "./sealing";

export const BACKUP_FORMAT = "somnium-backup";
export const BACKUP_LOCKED_FORMAT = "somnium-backup-locked";
export const BACKUP_VERSION = 1;
const PASSPHRASE_AAD = "somnium-backup-passphrase";

export interface BackupAccount { kdfSalt: string; wrappedByPassword: string; recoverySalt?: string | null; wrappedByRecovery?: string | null }
export interface BackupFile { format: typeof BACKUP_FORMAT; version: number; createdAt: string; account: BackupAccount; data: any }
export interface LockedBackupFile { format: typeof BACKUP_LOCKED_FORMAT; version: number; createdAt: string; kdf: { name: "argon2id"; salt: string; memoryKiB: number; iterations: number }; sealed: string }

/** An export in the clear (from the device's copy, or opened by the transport) sealed table by table under the data key. */
export async function sealExport(plain: any, dataKey: Uint8Array): Promise<any> {
  if (!plain || plain.app !== "somnium" || !plain.tables) throw new SealError("This is not a Somnium export");
  const tables: Record<string, Row[]> = {};
  for (const [t, rows] of Object.entries(plain.tables as Record<string, unknown>)) tables[t] = Array.isArray(rows) ? await sealRows(t, rows as Row[], dataKey) : [];
  const { unopened: _left, ...rest } = plain;
  return { ...rest, sealed: true, tables };
}

/** A sealed export opened: a row that doesn't open (another key, a changed byte) is left out and counted. */
export async function openExport(sealed: any, dataKey: Uint8Array): Promise<{ data: any; unopened: number }> {
  if (!sealed || sealed.app !== "somnium" || !sealed.tables) throw new SealError("This is not a Somnium export");
  if (!sealed.sealed) return { data: sealed, unopened: 0 };
  let unopened = 0;
  const tables: Record<string, Row[]> = {};
  for (const [t, rows] of Object.entries(sealed.tables as Record<string, unknown>)) {
    const out: Row[] = [];
    for (const r of Array.isArray(rows) ? (rows as Row[]) : []) {
      try { out.push(...(await unsealRows(t, [r], dataKey))); }
      catch (e) { if (!(e instanceof SealError)) throw e; unopened++; }
    }
    tables[t] = out;
  }
  return { data: { ...sealed, sealed: false, tables }, unopened };
}

/** The backup file from an export in the clear, the data key and the account's wrapped keys. */
export async function makeBackupFile(plain: any, dataKey: Uint8Array, account: BackupAccount, now = new Date()): Promise<BackupFile> {
  if (!account?.kdfSalt || !account.wrappedByPassword) throw new SealError("The account's keys are missing, so the backup could not be opened again");
  const acc: BackupAccount = { kdfSalt: account.kdfSalt, wrappedByPassword: account.wrappedByPassword };
  if (account.recoverySalt && account.wrappedByRecovery) { acc.recoverySalt = account.recoverySalt; acc.wrappedByRecovery = account.wrappedByRecovery; }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now.toISOString(), account: acc, data: await sealExport(plain, dataKey) };
}

/** Wraps a whole backup file with a passphrase (Argon2id key, AES-256-GCM). */
export async function lockBackupFile(file: BackupFile, passphrase: string): Promise<LockedBackupFile> {
  if (!passphrase) throw new SealError("A passphrase is needed");
  const salt = newSalt();
  const key = await argon2(passphrase, salt);
  try {
    return {
      format: BACKUP_LOCKED_FORMAT, version: BACKUP_VERSION, createdAt: file.createdAt,
      kdf: { name: "argon2id", salt: toBase64url(salt), memoryKiB: ARGON2.memoryKiB, iterations: ARGON2.iterations },
      sealed: await sealBytes(utf8(JSON.stringify(file)), key, PASSPHRASE_AAD),
    };
  } finally { key.fill(0); }
}

/** The backup inside a passphrase-wrapped file. A wrong passphrase throws a SealError. */
export async function unlockBackupFile(locked: LockedBackupFile, passphrase: string): Promise<BackupFile> {
  const key = await argon2(passphrase, fromBase64url(locked.kdf.salt));
  try { return parseBackupFile(fromUtf8(await unsealBytes(locked.sealed, key, PASSPHRASE_AAD))) as BackupFile; }
  finally { key.fill(0); }
}

/** What a file is: a backup, a passphrase-wrapped backup, a plain Somnium export, or none of these. */
export function parseBackupFile(text: string): BackupFile | LockedBackupFile | { format: "export"; data: any } {
  let o: any;
  try { o = JSON.parse(text); } catch { throw new SealError("This is not a Somnium backup"); }
  if (o?.format === BACKUP_FORMAT || o?.format === BACKUP_LOCKED_FORMAT) {
    if (Number(o.version) > BACKUP_VERSION) throw new SealError("This backup is from a newer version of Somnium. Update the app first.");
    if (o.format === BACKUP_FORMAT && (!o.account?.kdfSalt || !o.account?.wrappedByPassword || o.data?.app !== "somnium")) throw new SealError("This backup is damaged");
    if (o.format === BACKUP_LOCKED_FORMAT && (typeof o.sealed !== "string" || typeof o.kdf?.salt !== "string")) throw new SealError("This backup is damaged");
    return o;
  }
  if (o?.app === "somnium" && o.tables) return { format: "export", data: o };
  throw new SealError("This is not a Somnium backup");
}

/** Whether what was typed has the recovery key's shape (20 of its characters, dashes and spaces aside). */
const looksLikeRecoveryKey = (s: string) => /^[A-HJ-KMNP-Z2-9]{20}$/.test(s.toUpperCase().replace(/[\s-]/g, ""));

/** The data key from the file's account block, with the password or the recovery key. Wrong ones throw a SealError. */
export async function openBackupKey(file: BackupFile, secret: string): Promise<Uint8Array> {
  const a = file.account;
  try { return await openWithPassword({ salt: a.kdfSalt, wrappedByPassword: a.wrappedByPassword }, secret); }
  catch (e) { if (!(e instanceof SealError)) throw e; }
  if (a.recoverySalt && a.wrappedByRecovery && looksLikeRecoveryKey(secret)) {
    try { return (await openWithRecoveryKey({ recoverySalt: a.recoverySalt, wrappedByRecovery: a.wrappedByRecovery }, secret)).dataKey; }
    catch (e) { if (!(e instanceof SealError)) throw e; }
  }
  throw new SealError("That password or recovery key doesn't open this backup");
}
