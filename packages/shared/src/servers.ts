// Servers & accounts (PLAN.md §2, §6.7): the device's list of named servers and the accounts on them and on the device.
// Pure, so the Android app, the desktop app's main process and the tests share one set of rules. Names and addresses are
// plain settings, not journal content: they live in the device's account store, never sealed and never on a server.

export interface ServerEntry { id: string; name: string; url: string }
/** The last sync state the account's screens reported (kept so the list can show it while another account is open). */
export type SyncState = "synced" | "waiting" | "offline" | "locked" | "local" | "signedOut";
export interface SyncNote { state: SyncState; pending: number; at: number }
export interface AccountEntry {
  id: string; kind: "local" | "server"; name: string;
  /** server accounts: which saved server, and its address (kept on the account too, for the per-account copies and older code) */
  serverId?: string; url?: string;
  /** the username signed in with, once known */
  user?: string;
  sync?: SyncNote;
}
export interface AccountStore<A extends AccountEntry = AccountEntry> { list: A[]; active: string | null; servers: ServerEntry[] }

// ----- addresses -----
export type AddressCheck = { ok: true; origin: string; insecure: boolean; warning?: string } | { ok: false; error: string };

/** 127.0.0.0/8, localhost, ::1, and the private LAN ranges (10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7). */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (m.slice(1).some((x) => Number(x) > 255)) return false;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return /^f[cd][0-9a-f]{0,2}:/.test(h);
}

/**
 * "somnium.home", "192.168.1.5:8080" or "https://Somnium.Example.com/x/" → "https://somnium.home" (https unless told
 * otherwise). http is accepted only for this computer and the private LAN ranges, and then with a warning: anyone on
 * that network could read the sign-in on its way.
 */
export function checkServerAddress(input: string): AddressCheck {
  const s = String(input ?? "").trim();
  if (!s) return { ok: false, error: "Enter the server's address" };
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch { return { ok: false, error: "That doesn't look like an address" }; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname) return { ok: false, error: "The address must start with https://" };
  if (u.username || u.password) return { ok: false, error: "Leave the name and password out of the address: you sign in after adding it" };
  if (u.protocol === "https:") return { ok: true, origin: u.origin, insecure: false };
  if (!isLocalHost(u.hostname)) return { ok: false, error: "Use https. Plain http is only allowed for this computer (localhost) or a home network address like 192.168.x.x" };
  return { ok: true, origin: u.origin, insecure: true, warning: "This address uses http, so the connection isn't encrypted. Only use it on a network you trust." };
}

// ----- the list -----
export interface ServerGroup<A extends AccountEntry = AccountEntry> { server: ServerEntry; accounts: A[] }
export interface OrderedAccounts<A extends AccountEntry = AccountEntry> { device: A[]; servers: ServerGroup<A>[] }

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.name.localeCompare(b.name);

/** "This device" first (its accounts by name), then each server by its name, with its accounts by name. A server
 *  account whose server is missing (an older store) gets a server of its own made from its address. */
export function orderAccounts<A extends AccountEntry>(store: AccountStore<A>): OrderedAccounts<A> {
  const device = store.list.filter((a) => a.kind === "local").sort(byName);
  const groups = new Map<string, ServerGroup<A>>();
  for (const s of [...store.servers].sort(byName)) groups.set(s.id, { server: s, accounts: [] });
  for (const a of store.list) {
    if (a.kind !== "server") continue;
    let g = a.serverId ? groups.get(a.serverId) : undefined;
    if (!g) {
      const url = a.url ?? "";
      g = [...groups.values()].find((x) => x.server.url === url);
      if (!g) { g = { server: { id: a.serverId ?? `url:${url}`, name: hostOf(url) || a.name, url }, accounts: [] }; groups.set(g.server.id, g); }
    }
    g.accounts.push(a);
  }
  for (const g of groups.values()) g.accounts.sort((x, y) => byName(label(x), label(y)));
  return { device, servers: [...groups.values()] };
}
const label = (a: AccountEntry) => ({ name: a.user || a.name });
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ""; } };

/** Brings a store written by an older version (server accounts with only a name and an address) to the current shape:
 *  each address becomes a saved server named as the account was. Returns the same object when nothing changed. */
export function normaliseStore<A extends AccountEntry>(raw: unknown, newId: () => string): AccountStore<A> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AccountStore<A>>;
  const list = Array.isArray(r.list) ? r.list : [];
  const servers: ServerEntry[] = Array.isArray(r.servers) ? r.servers.filter((s) => s && typeof s.url === "string") : [];
  for (const a of list) {
    if (a.kind !== "server" || !a.url) continue;
    if (a.serverId && servers.some((s) => s.id === a.serverId)) continue;
    let s = servers.find((x) => x.url === a.url);
    if (!s) { s = { id: newId(), name: a.name || hostOf(a.url), url: a.url }; servers.push(s); }
    a.serverId = s.id;
  }
  const active = typeof r.active === "string" && list.some((a) => a.id === r.active) ? r.active : null;
  return { list, active, servers };
}

export function cleanName(name: unknown): string { return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 60); }

// ----- sync state -----
/** What the list says about an account's sync: "Synced", "Waiting · 3", "Offline", "Not syncing · locked". */
export function syncLabel(note: SyncNote | undefined, kind: AccountEntry["kind"]): string {
  if (kind === "local") return "On this device";
  if (!note) return "Not opened yet";
  const n = note.pending;
  switch (note.state) {
    case "synced": return "Synced";
    case "waiting": return `Waiting · ${n}`;
    case "offline": return n ? `Offline · ${n} waiting` : "Offline";
    case "locked": return n ? `Not syncing · locked · ${n} waiting` : "Not syncing · locked";
    case "signedOut": return "Signed out";
    default: return "On this device";
  }
}
/** The open server account's state from what its screens know. */
export function syncStateOf(s: { signedIn: boolean; copyOn: boolean; online: boolean; sealed: boolean; pending: number }): SyncState {
  if (!s.signedIn) return "signedOut";
  if (s.copyOn && !s.sealed) return "locked";
  if (!s.online) return "offline";
  return s.pending ? "waiting" : "synced";
}

// ----- removing -----
export interface RemovePlan { title: string; text: string; ok: string; /** unsent changes: a second, plainer question before anything goes */ unsent: number }
/** What removing an account or a server from this device takes with it, said plainly. pending: changes not yet on the server. */
export function removePlan(o: { what: "account" | "server"; name: string; kind: AccountEntry["kind"]; pending: number; accounts?: number; device: string }): RemovePlan {
  const pending = Math.max(0, o.pending | 0);
  if (o.what === "account" && o.kind === "local")
    return { title: `Remove ${o.name} from this ${o.device}?`, ok: "Remove", unsent: 0,
      text: "Its journal, settings and password on this " + o.device + " are deleted for good. It has no copy anywhere else: make a backup first if you want to keep it." };
  const many = o.what === "server" && (o.accounts ?? 0) > 1;
  const lose = pending ? ` ${pending} change${pending === 1 ? " that hasn't" : "s that haven't"} reached the server yet ${pending === 1 ? "is" : "are"} lost.` : "";
  return {
    title: o.what === "server" ? `Remove the server ${o.name}?` : `Remove ${o.name} from this ${o.device}?`,
    ok: "Remove", unsent: pending,
    text: (o.what === "server" ? `Its saved address and ${many ? `the ${o.accounts} accounts` : "the account"} on it are removed from this ${o.device}, with ${many ? "their copies" : "its copy"} of the journal here. ` : `This ${o.device} signs out of it and its copy of the journal here is deleted. `)
      + "Everything on the server stays there." + lose,
  };
}
