// Accounts inside the Android app (PLAN.md §2.4). Each account is local (the Somnium engine runs in the app with
// PGlite, data in this phone's storage) or a server account (the app's own screens with the data from that server, signed in
// with a token: the app is never loaded from the server). Any number of both, one open at a time.
// The desktop app has its own implementation in Electron (apps/desktop), exposed the same way as window.somniumNative.
import { reactive } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { checkServerAddress, cleanName, normaliseStore, removePlan, type AccountEntry, type AccountStore, type ServerEntry, type SyncNote } from "@somnium/shared";
import { server, setTransport, httpTransport, sealingTransport, type Transport, ApiError } from "../api/client";

/** keys: a local account's password and recovery envelope (LocalKeys in @somnium/shared), kept with the account.
 *  userId: who is signed in on a server account, so removing it deletes only that person's copy. */
export interface Account extends AccountEntry { token?: string; keys?: unknown; userId?: string }
const KEY = "somniumAccounts";
// servers: the saved servers, each with the name the person gave it (plain settings, not journal content; PLAN.md §6.7)
export const accounts = reactive<AccountStore<Account>>(normaliseStore<Account>(readJson(KEY, null), () => crypto.randomUUID()));
const save = () => writeJson(KEY, accounts);
// a store from before servers had names is brought up to date once (a browser, with nothing saved, writes nothing)
if (accounts.list.length || accounts.servers.length) save();
export const current = () => accounts.list.find((a) => a.id === accounts.active) ?? null;
/** What the cached session and similar records are kept under: per account, as two accounts on one server share its address. */
export const sessionScope = () => { const a = current(); return a?.kind === "server" && server.value.base ? "#" + a.id : ""; };

let engine: any = null, localDb: any = null;
async function localTransport(acc: Account): Promise<Transport> {
  const [{ createEngine }, { pgliteDb }] = await Promise.all([import("@somnium/engine"), import("@somnium/engine/pglite")]);
  const db = localDb = await pgliteDb(`idb://somnium-${acc.id}`);
  // sealed at rest like a server (LDJ-53): the engine refuses a sealed column in the clear, and the transport below
  // seals every one before it gets here
  engine = await createEngine(db, { mode: "server" });
  const userId = await engine.ensureLocalUser(acc.name);
  const { invalidate } = await import("../api/live");
  engine.onChange((_u: string, topics: string[]) => invalidate(topics));
  const sealed = sealingTransport({
    async request(method, path, body) {
      if (path.startsWith("/auth/status")) return { setupNeeded: false, registration: "closed", user: { id: userId, username: "me", role: "admin" }, version: (import.meta as any).env?.VITE_VERSION ?? "", apiLevel: 1 };
      if (path.startsWith("/update-check") || path.startsWith("/version")) return (globalThis as any).somniumNative?.update?.check?.() ?? { newer: false };
      if (path.startsWith("/auth/")) return { ok: true };
      const [p, qs] = path.split("?");
      const r = await engine.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs ?? "")), body, userId });
      if (r.status !== 200) throw new ApiError(r.status, r.body?.error ?? "Something went wrong");
      return r.body;
    },
  });
  return {
    async request(method, path, body, opts) {
      // photos added to a local account are kept as data inside it: in the dream's own text, which is sealed
      if (path.split("?")[0] === "/media" && body instanceof Blob) {
        const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(body); });
        return { id: url, url };
      }
      return sealed.request(method, path, body, opts);
    },
  };
}
/** The open local account's keys as stored (checked by the caller), and storing new ones. */
export const localKeys = async () => { const acc = current(); return acc?.kind === "local" ? acc.keys ?? null : null; };
export async function setLocalKeys(keys: unknown) {
  const acc = current();
  if (acc?.kind !== "local") throw new Error("Not a local account");
  acc.keys = keys; save();
}
/** After a journal made before passwords was sealed in place: its old plaintext leaves the database files. */
export async function compactLocal() { await engine?.compact(); }

/** Points the app at the open account. Returns false when there is none (the chooser shows). */
export async function connect(): Promise<boolean> {
  const acc = current();
  if (!acc) return false;
  if (acc.kind === "local") setTransport(await localTransport(acc));
  else { server.value = { base: acc.url!, token: acc.token ?? null }; setTransport(httpTransport); }
  return true;
}
export async function addLocal(name: string) {
  const acc: Account = { id: crypto.randomUUID(), kind: "local", name: cleanName(name) || "Me" };
  accounts.list.push(acc);
  await open(acc.id);
}
/** Checks a Somnium server answers at an address: its /api/version names its API level. A timer, not an AbortSignal:
 *  on Android fetch goes through CapacitorHttp, which ignores the signal. */
async function checkServer(input: string): Promise<string> {
  const c = checkServerAddress(input);
  if (!c.ok) throw new Error(c.error);
  // the app has no permission for unencrypted connections (Android blocks them), so an http:// server could never be reached
  if (c.insecure) throw new Error("The Android app only connects over https (Android blocks unencrypted connections). Use the https address of your server.");
  const late = Symbol();
  const r = await Promise.race([
    fetch(c.origin + "/api/version", { headers: { "x-somnium": "1" } }).catch(() => null),
    new Promise<typeof late>((ok) => setTimeout(() => ok(late), 8000)),
  ]);
  if (r === late) throw new Error("No answer from that address in 8 seconds. Check the address and that the server is running.");
  if (!r) throw new Error("Couldn't reach that address. Check it, and that this phone is on a network that can reach the server.");
  const j = r.ok ? await r.json().catch(() => null) : null;
  if (!j || typeof j.apiLevel !== "number") throw new Error("Something answered at that address, but it isn't a Somnium server");
  return c.origin;
}

/** Saves a server after checking a Somnium server answers there, with an account on it, and opens that: its sign-in screen comes next. */
export async function addServer(url: string, name?: string) {
  const base = await checkServer(url);
  const had = accounts.servers.find((s) => s.url === base);
  if (had) throw new Error(`That server is already saved as ${had.name}. To use another account on it, choose "Add an account" in its menu.`);
  const s: ServerEntry = { id: crypto.randomUUID(), name: cleanName(name) || new URL(base).host, url: base };
  accounts.servers.push(s);
  await addAccount(s.id);
}
/** Another account on a saved server: it opens on its sign-in screen. */
export async function addAccount(serverId: string) {
  const s = accounts.servers.find((x) => x.id === serverId);
  if (!s) throw new Error("That server isn't saved here");
  const acc: Account = { id: crypto.randomUUID(), kind: "server", name: s.name, serverId: s.id, url: s.url };
  accounts.list.push(acc);
  await open(acc.id);
}
export function renameServer(id: string, name: string) {
  const s = accounts.servers.find((x) => x.id === id), n = cleanName(name);
  if (s && n) { s.name = n; save(); }
}
/** A server that moved: its accounts follow it. Their copies here were kept under the old address and are made again. */
export async function setServerAddress(id: string, url: string) {
  const s = accounts.servers.find((x) => x.id === id);
  if (!s) return;
  const base = await checkServer(url);
  if (base === s.url) return;
  if (accounts.servers.some((x) => x.url === base && x.id !== id)) throw new Error("Another saved server has that address");
  const old = s.url, onIt = accounts.list.filter((a) => a.serverId === id);
  s.url = base;
  for (const a of onIt) { a.url = base; writeJson("somniumSession:" + old + "#" + a.id, null); }
  save();
  const { eraseCopiesOf } = await import("../api/replica");
  if (!accounts.list.some((a) => a.url === old)) await eraseCopiesOf(old);
  if (onIt.some((a) => a.id === accounts.active)) location.reload();
}
/** After signing in (or out) on the open server account: the token it uses from now on. */
export function setToken(token: string | null) {
  const acc = current();
  if (acc?.kind !== "server") return;
  acc.token = token ?? undefined;
  if (!token) { acc.user = undefined; acc.userId = undefined; }
  save();
  server.value = { base: acc.url!, token };
}
/** Who is signed in on the open account, and how its sync is going: shown in the list while another account is open. */
export function setStatus(st: { user?: { id: string; username: string } | null; sync?: SyncNote }) {
  const acc = current();
  if (!acc) return;
  let changed = false;
  if (st.user !== undefined && acc.kind === "server" && (acc.user !== st.user?.username || acc.userId !== st.user?.id)) { acc.user = st.user?.username; acc.userId = st.user?.id; changed = true; }
  if (st.sync && JSON.stringify(acc.sync) !== JSON.stringify(st.sync)) { acc.sync = st.sync; changed = true; }
  if (changed) save();
}
export function rename(id: string, name: string) {
  const acc = accounts.list.find((a) => a.id === id), n = cleanName(name);
  if (acc && n) { acc.name = n; save(); }
}
/** Closes the open account's database before the app opens another (the screens have locked and dropped the key first). */
async function closeOpen() { await localDb?.close().catch(() => {}); localDb = engine = null; }
export async function open(id: string) { await closeOpen(); accounts.active = id; save(); location.reload(); }
/** Removes an account from this phone without asking (the screens asked, with what is lost: removePlan in @somnium/shared). */
async function drop(acc: Account) {
  const { eraseCopiesOf, eraseCopyOf, eraseReplica, dropDatabase } = await import("../api/replica");
  // the open account's database has to be closed first, or deleting it waits until the app is closed
  if (acc.kind === "local") { if (accounts.active === acc.id) await closeOpen(); await dropDatabase(`/pglite/somnium-${acc.id}`); }
  else {
    // sign this phone out on the server too, and drop the copy of its data kept here
    if (acc.token) await fetch(acc.url + "/api/auth/logout", { method: "POST", headers: { "x-somnium": "1", authorization: `Bearer ${acc.token}`, "content-type": "application/json" }, body: "{}" }).catch(() => {});
    if (accounts.active === acc.id) await eraseReplica();
    // another account on the same server keeps its own copy
    if (!accounts.list.some((a) => a.id !== acc.id && a.url === acc.url)) await eraseCopiesOf(acc.url!);
    else if (acc.userId) await eraseCopyOf(acc.url!, acc.userId);
    writeJson("somniumSession:" + acc.url + "#" + acc.id, null);
    writeJson("somniumSession:" + acc.url, null);
  }
  accounts.list = accounts.list.filter((a) => a.id !== acc.id);
}
export async function removeAccount(id: string) {
  const acc = accounts.list.find((a) => a.id === id);
  if (!acc) return;
  const wasOpen = accounts.active === id;
  await drop(acc);
  if (wasOpen) accounts.active = null;
  save();
  if (wasOpen) location.reload();
}
export async function removeServer(id: string) {
  const s = accounts.servers.find((x) => x.id === id);
  if (!s) return;
  const wasOpen = accounts.list.some((a) => a.serverId === id && a.id === accounts.active);
  for (const a of accounts.list.filter((x) => x.serverId === id)) await drop(a);
  accounts.servers = accounts.servers.filter((x) => x.id !== id);
  if (wasOpen) accounts.active = null;
  save();
  if (wasOpen) location.reload();
}
/** The chooser's remove: asks first, naming what goes. */
export async function remove(id: string) {
  const acc = accounts.list.find((a) => a.id === id);
  if (!acc) return;
  const { confirm } = await import("../core/ask");
  const p = removePlan({ what: "account", name: acc.user || acc.name, kind: acc.kind, pending: acc.sync?.pending ?? 0, device: "phone" });
  if (!(await confirm(p.title, { ok: p.ok, danger: true, text: p.text }))) return;
  if (p.unsent && !(await confirm(`${p.unsent} change${p.unsent === 1 ? " is" : "s are"} not on the server yet`, { ok: "Remove anyway", danger: true, text: "They exist only on this phone and are lost if you remove the account now. Open it while the server can be reached and they are sent." }))) return;
  await removeAccount(id);
}
export const chooser = async () => { await closeOpen(); accounts.active = null; save(); location.reload(); };
