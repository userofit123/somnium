// Sealing at the device/server boundary (PLAN.md §4.1). Rows live in plaintext on a device (its replica, or a local
// account's own database) and as ciphertext on the server. The only places a row crosses that line are sync's
// push, pull and first snapshot (replica.ts), and those call sealRows on the way out and unsealRows on the way in,
// so Electron, Android and the web app share one implementation and the server's code never sees a key.
//
// Local accounts (no server) hold plaintext in their own database: nothing of theirs ever leaves the device, and
// the data is protected by the device (its storage, its screen lock) and by the app lock (PLAN.md §4.3). Their
// data key exists for backups and for a later move to a server (docs/security.md).
//
// Every sealed value is bound to its place with aad "<table>.<column>.<row id>", so a ciphertext copied into
// another row or column (by someone holding the database but not the key) fails to open.
import { SealError, fromBase64url, isSealed, sealColumn, toBase64url, unsealColumn, unsealColumnBytes } from "@somnium/shared";
import { SEALED_COLUMNS, SEALED_TABLES } from "../sealed";
import type { Change } from "./core";

export type Row = Record<string, unknown>;

/** Sealed columns that hold a file rather than text: on the device as base64url, sealed as the raw bytes. */
export const BYTES_COLUMNS: Readonly<Record<string, readonly string[]>> = { media: ["data"] };

/** Thrown when rows of a sealed table must cross the boundary and the device has no data key open. */
export class LockedError extends SealError {
  constructor() { super("The journal key isn't open on this device"); this.name = "LockedError"; }
}

/** Whether rows of this table need the data key to be sent or received. */
export const needsKey = (table: string): boolean => SEALED_TABLES.includes(table);

const rowId = (table: string, row: Row): string => {
  if (typeof row.id !== "string" || !row.id) throw new SealError(`A ${table} row without an id cannot be sealed`);
  return row.id;
};

/** The row with every sealed column encrypted. A value already in envelope form (a file sealed before upload) is kept. */
export async function sealRow(table: string, row: Row, dataKey: Uint8Array): Promise<Row> {
  const cols = SEALED_COLUMNS[table];
  if (!cols?.length) return row;
  const out: Row = { ...row };
  const id = rowId(table, row);
  for (const c of cols) {
    const v = row[c];
    if (v == null || isSealed(v)) continue;
    const plain = BYTES_COLUMNS[table]?.includes(c) ? fromBase64url(String(v)) : String(v);
    out[c] = await sealColumn(plain, dataKey, table, c, id);
  }
  return out;
}

/**
 * The row with every sealed column decrypted. A value that is not an envelope is kept as it is: it was written
 * before sealing existed (or straight to the server by an old client) and is plain already; an envelope that
 * does not open (wrong key, a changed byte, a value moved from another row) throws a SealError.
 */
export async function unsealRow(table: string, row: Row, dataKey: Uint8Array): Promise<Row> {
  const cols = SEALED_COLUMNS[table];
  if (!cols?.length) return row;
  const out: Row = { ...row };
  const id = rowId(table, row);
  for (const c of cols) {
    const v = row[c];
    if (v == null || !isSealed(v)) continue;
    out[c] = BYTES_COLUMNS[table]?.includes(c)
      ? toBase64url(await unsealColumnBytes(v, dataKey, table, c, id))
      : await unsealColumn(v, dataKey, table, c, id);
  }
  return out;
}

/** Seals every row of a table; a sealed table with no key open is refused before anything is touched. */
export async function sealRows(table: string, rows: Row[], dataKey: Uint8Array | null | undefined): Promise<Row[]> {
  if (!needsKey(table) || !rows.length) return rows;
  if (!dataKey) throw new LockedError();
  return Promise.all(rows.map((r) => sealRow(table, r, dataKey)));
}

export async function unsealRows(table: string, rows: Row[], dataKey: Uint8Array | null | undefined): Promise<Row[]> {
  if (!needsKey(table) || !rows.length) return rows;
  if (!dataKey) throw new LockedError();
  return Promise.all(rows.map((r) => unsealRow(table, r, dataKey)));
}

/** Sync changes about to leave the device: their rows sealed (deletions carry no row and pass as they are). */
export async function sealChanges(changes: Change[], dataKey: Uint8Array | null | undefined): Promise<Change[]> {
  if (!dataKey && changes.some((c) => c.row && needsKey(c.tbl))) throw new LockedError();
  return Promise.all(changes.map(async (c) => (c.row && needsKey(c.tbl) ? { ...c, row: await sealRow(c.tbl, c.row, dataKey!) } : c)));
}

/** Sync changes that just arrived from the server: their rows opened. */
export async function unsealChanges(changes: Change[], dataKey: Uint8Array | null | undefined): Promise<Change[]> {
  if (!dataKey && changes.some((c) => c.row && needsKey(c.tbl))) throw new LockedError();
  return Promise.all(changes.map(async (c) => (c.row && needsKey(c.tbl) ? { ...c, row: await unsealRow(c.tbl, c.row, dataKey!) } : c)));
}
