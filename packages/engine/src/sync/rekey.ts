// Restoring another account's backup or export (LDJ-62). Row ids are global on a server: rows restored under the ids
// they had in the other account would collide with that account's rows, which row-level security keeps out of sight,
// so the server refuses every one. Restored into a different account, each row gets an id of its own there, and every
// value that pointed at one of the file's rows (a dream's night, a link's dream and element, a merged night's
// survivor) is pointed at the new id, so the links between them hold.
//
// The new id is derived from the account and the old id, not random: restoring the same file into the same account
// again (a second merge) lands on the same rows instead of doubling them. It keeps the old id's time part, so rows
// stay in the order they were made. Sealed values are bound to their row id (table.column.rowId), so this runs on the
// journal in the clear, before it is sealed for this account.
import { mergeMark, mergingInto } from "@somnium/shared";
import { isUuid } from "../ids";

export interface Account { id: string; username?: string | null }

/** Whether the file comes from another account: its owner's id (exports since LDJ-62), else its user name. A file
 *  that names no one is taken as this account's, as before. */
export function fromOtherAccount(data: any, me: Account): boolean {
  const u = data?.user;
  if (u?.id) return String(u.id).toLowerCase() !== me.id.toLowerCase();
  if (u?.username && me.username) return String(u.username).toLowerCase() !== String(me.username).toLowerCase();
  return false;
}

async function derivedId(accountId: string, oldId: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`somnium-restore:${accountId.toLowerCase()}:${oldId.toLowerCase()}`)));
  const old = oldId.replace(/-/g, "");
  for (let i = 0; i < 6; i++) h[i] = parseInt(old.slice(i * 2, i * 2 + 2), 16);
  h[6] = (h[6]! & 0x0f) | 0x70;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const plainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

/** The file as this account restores it: unchanged when it is this account's own, else with new ids (see above) and
 *  marked as this account's, so a second pass (the transport, then the engine) leaves it alone. */
export async function rekeyForAccount<T extends { tables?: Record<string, unknown>; user?: any }>(data: T, me: Account): Promise<T> {
  if (!data?.tables || !fromOtherAccount(data, me)) return data;
  const ids = new Map<string, string>();
  for (const rows of Object.values(data.tables))
    if (Array.isArray(rows)) for (const r of rows) if (isUuid(r?.id) && !ids.has(r.id.toLowerCase())) ids.set(r.id.toLowerCase(), await derivedId(me.id, r.id));
  // only whole values that are one of the file's ids: a uuid inside a text is a text
  const swap = (v: unknown): unknown =>
    typeof v === "string" ? ids.get(v.toLowerCase()) ?? v
    : Array.isArray(v) ? v.map(swap)
    : plainObject(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]))
    : v;
  // the one id inside a text: a merge cut short marks the merged element's note with the element it goes into
  // (signs.ts), and finishing it after the restore has to find that element under its new id
  const remark = (row: any) => {
    const into = mergingInto(row?.note);
    const now = into && ids.get(into.toLowerCase());
    return now ? { ...row, note: mergeMark(now, row.note) } : row;
  };
  const tables = Object.fromEntries(Object.entries(data.tables).map(([t, rows]) =>
    [t, Array.isArray(rows) ? rows.map((r) => { const x = swap(r); return t === "elements" ? remark(x) : x; }) : rows]));
  return { ...data, user: { ...(data.user ?? {}), id: me.id }, tables };
}
