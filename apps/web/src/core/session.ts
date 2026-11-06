// Who is signed in, and how this app reaches its data.
import { reactive } from "vue";
import { api, setOnUnauthorized, ApiError, server, usingHttp } from "../api/client";
import { queryClient, invalidate } from "../api/live";
import { readJson, writeJson } from "./prefs";
import { startReplica, eraseReplica, sync, copyHasUnsent, unreachable } from "../api/replica";
import { confirm } from "./ask";
import { setToken } from "../native/accounts";

export const session = reactive<{ ready: boolean; setupNeeded: boolean; user: { id: string; username: string; role: string } | null; registration: string; version: string; apiLevel: number }>(
  { ready: false, setupNeeded: false, user: null, registration: "invite", version: "", apiLevel: 0 });

// the last answer from the server, so the app can open without a connection
const KEY = () => "somniumSession:" + (server.value.base || location.origin);

export async function loadSession() {
  let s: any = null, offline = false;
  // the app doesn't wait long on a server that doesn't answer: a few seconds, then it opens on this device's copy
  // (the copy syncs once the server answers again). With nothing saved on this device there is no copy to open on,
  // so it waits for the real answer (a slow server would otherwise look like "signed out").
  const saved = readJson<any>(KEY(), null);
  const answer = api.get("/auth/status", undefined, saved ? undefined : { wait: 0 });
  const slow = () => new Promise<never>((_, no) => setTimeout(() => no(new ApiError(0, "No answer")), 5000));
  try { s = await (saved ? Promise.race([answer, slow()]) : answer); writeJson(KEY(), s.user ? s : null); }
  catch (e) { if (e instanceof ApiError && e.status === 0) { s = saved; offline = true; if (navigator.onLine) unreachable(); else sync.online = false; } }
  if (s) Object.assign(session, { setupNeeded: s.setupNeeded, user: s.user, registration: s.registration, version: s.version, apiLevel: s.apiLevel });
  else session.user = null;
  // a server account works on a copy on this device (offline use); local accounts already are one
  // Online, the screens show straight from the server while the copy opens (about a second) and take it over when
  // it's ready; offline, the copy is all there is, so wait for it.
  if (session.user && usingHttp() && !(await isLocalAccount())) {
    const opening = startReplica(session.user).then((ok) => { if (ok && !offline) invalidate(["*"]); });
    // with changes on this device the server hasn't got (a dream written just before the app was closed), the
    // server's view is out of date: wait for the copy, which sends them first (a few seconds at most)
    if (offline || (await copyHasUnsent(session.user))) await opening;
  }
  session.ready = true;
}
/** A local account in the desktop or Android app: everything on this device, no password and no server to ask. */
export async function isLocalAccount() {
  try { return (await (globalThis as any).somniumNative?.accounts?.current?.())?.kind === "local"; } catch { return false; }
}

export async function signOut() {
  if (sync.on && sync.waiting && !(await confirm(`${sync.waiting} change${sync.waiting === 1 ? " hasn't" : "s haven't"} reached the server yet`,
    { text: "Signing out removes them from this device. Stay signed in and they're sent when the server can be reached.", ok: "Sign out anyway", danger: true }))) return;
  try { await api.post("/auth/logout"); } catch { /* signed out anyway */ }
  setToken(null);
  await eraseReplica();
  writeJson(KEY(), null);
  session.user = null;
  queryClient.clear();
}
// the server no longer accepts the saved token (signed out elsewhere, or expired): forget it too
setOnUnauthorized(() => { setToken(null); if (session.user) { session.user = null; writeJson(KEY(), null); queryClient.clear(); } });
