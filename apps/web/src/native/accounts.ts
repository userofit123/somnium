// Accounts inside the Android app (PLAN.md §2.4). Each account is local (the Somnium engine runs in the app with
// PGlite, data in this phone's storage) or a server account (the app's own screens with the data from that server, signed in
// with a token: the app is never loaded from the server). Any number of both, one open at a time.
// The desktop app has its own implementation in Electron (apps/desktop), exposed the same way as window.somniumNative.
import { reactive } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { server, setTransport, httpTransport, sealingTransport, type Transport, ApiError } from "../api/client";

/** keys: a local account's password and recovery envelope (LocalKeys in @somnium/shared), kept with the account. */
export interface Account { id: string; kind: "local" | "server"; name: string; url?: string; token?: string; keys?: unknown }
const KEY = "somniumAccounts";
export const accounts = reactive<{ list: Account[]; active: string | null }>(readJson(KEY, { list: [], active: null }));
const save = () => writeJson(KEY, accounts);
export const current = () => accounts.list.find((a) => a.id === accounts.active) ?? null;

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
  const acc: Account = { id: crypto.randomUUID(), kind: "local", name: name || "Me" };
  accounts.list.push(acc); accounts.active = acc.id; save();
  location.reload();
}
/** "somnium.home", "192.168.1.5:8080" or "https://Somnium.Example.com/x/" → "https://somnium.home" (https unless told otherwise). */
export function serverAddress(input: string) {
  const s = input.trim();
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); if (/^https?:$/.test(u.protocol) && u.hostname) return u.origin; } catch { /* not an address */ }
  throw new Error("That doesn't look like an address");
}
/** Saves a server after checking a Somnium server answers there, and opens it: its sign-in screen comes next. */
export async function addServer(url: string, name?: string) {
  const base = serverAddress(url);
  // the app has no permission for unencrypted connections, so an http:// server could never be reached from it
  if (base.startsWith("http://")) throw new Error("This app only connects over https. Use the https address of your server.");
  if (accounts.list.some((a) => a.url === base)) throw new Error("That server is already in the list");
  // a timer, not an AbortSignal: on Android fetch goes through CapacitorHttp, which ignores the signal
  const late = Symbol();
  const r = await Promise.race([
    fetch(base + "/api/auth/status", { headers: { "x-somnium": "1" } }).catch(() => null),
    new Promise<typeof late>((ok) => setTimeout(() => ok(late), 8000)),
  ]);
  if (r === late) throw new Error("No answer from that address");
  const j = r?.ok ? await r.json().catch(() => null) : null;
  if (!j || typeof j.apiLevel !== "number") throw new Error("No Somnium server answered at that address");
  const acc: Account = { id: crypto.randomUUID(), kind: "server", name: name?.trim().slice(0, 60) || new URL(base).host, url: base };
  accounts.list.push(acc); accounts.active = acc.id; save();
  location.reload();
}
/** After signing in (or out) on the open server account: the token it uses from now on. */
export function setToken(token: string | null) {
  const acc = current();
  if (acc?.kind !== "server") return;
  acc.token = token ?? undefined; save();
  server.value = { base: acc.url!, token };
}
export function rename(id: string, name: string) {
  const acc = accounts.list.find((a) => a.id === id);
  if (acc && name.trim()) { acc.name = name.trim().slice(0, 60); save(); }
}
export function open(id: string) { accounts.active = id; save(); location.reload(); }
export async function remove(id: string) {
  const acc = accounts.list.find((a) => a.id === id);
  if (!acc) return;
  const { confirm } = await import("../core/ask");
  if (!(await confirm(`Remove ${acc.name} from this phone?`, { ok: "Remove", danger: true,
    text: acc.kind === "local" ? "Its data on this phone is deleted. Make a backup first if you want to keep it." : "Your data stays on the server. Changes not sent to it yet are lost." }))) return;
  const { eraseCopiesOf, eraseReplica, dropDatabase } = await import("../api/replica");
  // the open account's database has to be closed first, or deleting it waits until the app is closed
  if (acc.kind === "local") { if (accounts.active === id) { await localDb?.close().catch(() => {}); localDb = engine = null; } await dropDatabase(`/pglite/somnium-${id}`); }
  else {
    // sign this phone out on the server too, and drop the copy of its data kept here
    if (acc.token) await fetch(acc.url + "/api/auth/logout", { method: "POST", headers: { "x-somnium": "1", authorization: `Bearer ${acc.token}`, "content-type": "application/json" }, body: "{}" }).catch(() => {});
    if (accounts.active === id) await eraseReplica();
    await eraseCopiesOf(acc.url!);
    writeJson("somniumSession:" + acc.url, null);
  }
  accounts.list = accounts.list.filter((a) => a.id !== id);
  if (accounts.active === id) accounts.active = null;
  save();
  location.reload();
}
export const chooser = () => { accounts.active = null; save(); location.reload(); };
