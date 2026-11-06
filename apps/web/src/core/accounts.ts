// Servers & accounts on the screens' side (PLAN.md §2, §6.7): what the desktop or Android app keeps (window.somniumNative
// .accounts: apps/desktop/src/main.ts, native/accounts.ts), switching cleanly, and telling the app how the open
// account's sync is going so the list can show it while another account is open.
// In a browser the server is the site itself: there is only "this server", whose name is kept in this browser.
import { reactive, ref, watch } from "vue";
import { syncLabel, syncStateOf, type AccountEntry, type ServerEntry, type SyncNote } from "@somnium/shared";
import { session, unsentChanges, signOut } from "./session";
import { sync } from "../api/replica";
import { detachReplica } from "../api/replica";
import { keyring } from "./keyring";
import { lockNow } from "./lock";
import { queryClient } from "../api/live";
import { readStr, writeStr } from "./prefs";

export interface NativeAccounts {
  list(): Promise<{ list: AccountEntry[]; active: string | null; servers: ServerEntry[] }>;
  current(): Promise<AccountEntry | null>;
  addLocal(name: string): Promise<void>;
  addServer(url: string, name: string): Promise<void>;
  addAccount(serverId: string): Promise<void>;
  open(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  renameServer(id: string, name: string): Promise<void>;
  setServerAddress(id: string, url: string): Promise<void>;
  setStatus(st: { user?: { id: string; username: string } | null; sync?: SyncNote }): Promise<void>;
  removeAccount(id: string): Promise<void>;
  removeServer(id: string): Promise<void>;
  device?: string; insecureAllowed?: boolean;
}
export const nativeAccounts = (): NativeAccounts | undefined => (globalThis as { somniumNative?: { accounts?: NativeAccounts } }).somniumNative?.accounts;
/** "phone" or "computer": how the screens name this device. */
export const deviceWord = () => nativeAccounts()?.device ?? "device";

export const saved = reactive<{ list: AccountEntry[]; active: string | null; servers: ServerEntry[]; loaded: boolean }>({ list: [], active: null, servers: [], loaded: false });
export async function refreshAccounts() {
  const n = nativeAccounts();
  if (!n) return;
  try { const a = await Promise.resolve(n.list()); Object.assign(saved, { list: a.list, active: a.active, servers: a.servers ?? [], loaded: true }); } catch { /* keeps the last list */ }
}

/** The open account's sync, as the list says it. "Locked" means the journal key isn't open here (nothing sealed can travel). */
export function openSyncNote(): SyncNote {
  const local = saved.list.find((a) => a.id === saved.active)?.kind === "local";
  const pending = session.user ? unsentChanges() : 0;
  if (local) return { state: "local", pending: 0, at: Date.now() };
  return { state: syncStateOf({ signedIn: !!session.user, copyOn: sync.on, online: sync.on ? sync.online : navigator.onLine, sealed: sync.sealed || keyring.isOpen(), pending }), pending, at: Date.now() };
}
export const labelFor = (a: AccountEntry) => syncLabel(a.id === saved.active ? openSyncNote() : a.sync, a.kind);
/** The open account's sync, in a browser too (where there is no saved list). */
export const currentSyncLabel = () => syncLabel(openSyncNote(), saved.list.find((a) => a.id === saved.active)?.kind ?? "server");

/** Reports who is signed in and the sync state to the app as they change (a count and a state: nothing personal). */
export function startStatusReports() {
  const n = nativeAccounts();
  if (!n) return;
  void refreshAccounts();
  let last = "", t: ReturnType<typeof setTimeout> | null = null;
  watch(() => [session.user?.id, session.user?.username, sync.on, sync.online, sync.sealed, sync.waiting, session.user ? unsentChanges() : 0], () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      const note = openSyncNote(), key = JSON.stringify([session.user?.id, note.state, note.pending]);
      if (key === last) return;
      last = key;
      // the Android bridge answers at once, the desktop one with a promise
      void Promise.resolve().then(() => n.setStatus({ user: session.user ? { id: session.user.id, username: session.user.username } : null, sync: note })).catch(() => {});
    }, 600);
  }, { immediate: true });
}

/**
 * Leaves the open account before another opens: the journal locks, the key is dropped, the copy closes and nothing it
 * showed stays in memory. The next account starts on its own lock screen (or sign-in), in a fresh page.
 */
export async function closeCurrent() {
  lockNow();
  keyring.clear();
  queryClient.clear();
  await detachReplica().catch(() => {});
}
export async function switchTo(id: string) {
  const n = nativeAccounts();
  if (!n || id === saved.active) return;
  await closeCurrent();
  await n.open(id);
}

// ----- a browser: the site's own server, named here -----
const NAME = "somniumServerName";
export const webServerName = ref(readStr(NAME, "") || location.host);
export function renameWebServer(name: string) {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!n) return;
  writeStr(NAME, n);
  webServerName.value = n;
}
export { signOut };
