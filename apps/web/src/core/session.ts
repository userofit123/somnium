// Who is signed in, and how this app reaches its data.
import { reactive } from "vue";
import { api, newSessionEra, setOnUnauthorized, setLocalDevice, ApiError, server, usingHttp } from "../api/client";
import { queryClient, invalidate } from "../api/live";
import { readJson, writeJson } from "./prefs";
import { startReplica, eraseReplica, detachReplica, eraseCopiesLeftByOthers, copyOpenFor, sync, copyHasUnsent, unreachable } from "../api/replica";
import { copyDecision } from "@somnium/shared";
import { confirm } from "./ask";
import { setToken, sessionScope } from "../native/accounts";
import { keyring } from "./keyring";
import { forgetUnlock, forgetUnlocksOfOthers } from "./unlock";
import { forgetCachedMedia } from "../api/media";
import { clearOutbox, openOutbox, waiting as outboxWaiting } from "../api/outbox";
import { forgetStoredDrafts, storedDraftCount } from "../api/draftStore";

export const session = reactive<{ ready: boolean; setupNeeded: boolean; user: { id: string; username: string; role: string } | null; registration: string; version: string; apiLevel: number }>(
  { ready: false, setupNeeded: false, user: null, registration: "invite", version: "", apiLevel: 0 });

// the last answer from the server, so the app can open without a connection
// (per account in the Android app, where two accounts on one server share its address)
const KEY = () => "somniumSession:" + (server.value.base || location.origin) + sessionScope();

export async function loadSession() {
  setLocalDevice(await isLocalAccount());
  let s: any = null, offline = false, answered = false;
  // the app doesn't wait long on a server that doesn't answer: a few seconds, then it opens on this device's copy
  // (the copy syncs once the server answers again). With nothing saved on this device there is no copy to open on,
  // so it waits for the real answer (a slow server would otherwise look like "signed out").
  const saved = readJson<any>(KEY(), null);
  const answer = api.get("/auth/status", undefined, saved ? undefined : { wait: 0 });
  const slow = () => new Promise<never>((_, no) => setTimeout(() => no(new ApiError(0, "No answer")), 5000));
  try {
    s = await (saved ? Promise.race([answer, slow()]) : answer);
    answered = true;
    writeJson(KEY(), s.user ? s : null);
  }
  catch (e) { if (e instanceof ApiError && e.status === 0) { s = saved; offline = true; if (navigator.onLine) unreachable(); else sync.online = false; } }
  if (s) Object.assign(session, { setupNeeded: s.setupNeeded, user: s.user, registration: s.registration, version: s.version, apiLevel: s.apiLevel });
  else session.user = null;
  // what opens someone's journal is only ever offered to them: their session may have ended while the app was closed
  if (session.user) forgetUnlocksOfOthers(session.user.id);
  else if (answered && saved?.user) forgetUnlock(saved.user.id);
  // this tab may be on someone else's copy: leave it before anything of this session can touch it
  if (copyDecision(copyOpenFor(), session.user?.id ?? null).stop) await detachReplica();
  openOutbox(server.value.base || location.origin, session.user?.id ?? null);
  // a server account works on a copy on this device (offline use); local accounts already are one
  // Online, the screens show straight from the server while the copy opens (about a second) and take it over when
  // it's ready; offline, the copy is all there is, so wait for it.
  copyWanted = !!session.user && usingHttp() && !(await isLocalAccount());
  if (session.user && copyWanted) {
    // a copy this page still holds can't be deleted until the page lets go of it. Once only: another tab may hold it too.
    if ((await eraseCopiesLeftByOthers(session.user)) && reloadOnce(session.user.id)) return;
    const opening = startReplica(session.user).then((ok) => { if (ok && !offline) invalidate(["*"]); });
    // with changes on this device the server hasn't got (a dream written just before the app was closed), the
    // server's view is out of date: wait for the copy, which sends them first (a few seconds at most)
    if (offline || (await copyHasUnsent(session.user))) await opening;
  }
  session.ready = true;
}
// A first copy can't be made without the key (it opens the server's snapshot), and the app starts locked: that copy is
// made as the journal unlocks. The same when it couldn't be opened for that reason later on.
let copyWanted = false;
keyring.onChange((open) => {
  const user = session.user;
  if (!open || !user || !copyWanted || copyOpenFor() !== null) return;
  void startReplica(user).then((ok) => { if (ok && session.user?.id === user.id) invalidate(["*"]); });
});
/** A local account in the desktop or Android app: everything on this device, sealed with its own password (core/localLock.ts), no server to ask. */
export async function isLocalAccount() {
  try { return (await (globalThis as any).somniumNative?.accounts?.current?.())?.kind === "local"; } catch { return false; }
}

function reloadOnce(userId: string) {
  const mark = "somniumReloadedToErase:" + userId;
  try { if (sessionStorage.getItem(mark)) return false; sessionStorage.setItem(mark, "1"); } catch { return false; }
  location.reload();
  return true;
}

/** What signing out would lose: changes on this device the server hasn't got. */
export const unsentChanges = () => (sync.on ? sync.waiting : 0) + outboxWaiting.value.length + (session.user ? storedDraftCount(server.value.base || location.origin, session.user.id) : 0);
/** force: without asking first (the lock screen, which asks in its own way). */
export async function signOut(o: { force?: boolean } = {}) {
  const unsent = unsentChanges();
  if (!o.force && unsent && !(await confirm(`${unsent} change${unsent === 1 ? " hasn't" : "s haven't"} reached the server yet`,
    { text: "Signing out removes them from this device. Stay signed in and they're sent when the server can be reached.", ok: "Sign out anyway", danger: true }))) return;
  const who = session.user; // a 401 from the server below clears session.user, and this person's copy must still go
  newSessionEra();
  clearOutbox(); // first: nothing queued may go out between here and the session ending
  try { await api.post("/auth/logout"); } catch { /* signed out anyway */ }
  setToken(null);
  keyring.clear(); // the data key leaves with the session (PLAN.md §4.1)
  if (who) forgetUnlock(who.id);
  const stillHeld = who ? await eraseReplica(who) : false;
  await forgetCachedMedia();
  writeJson(KEY(), null);
  session.user = null;
  // Drafts sealed here go with the rest of what hasn't been sent, as the question above said (the same rule as the
  // outbox and the device copy). A session that ends without signing out keeps them for the person's next sign-in.
  // After session.user is gone: a draft sealed as the key left (keyring.onBeforeClear) can't be written back now.
  if (who) forgetStoredDrafts(server.value.base || location.origin, who.id);
  openOutbox(server.value.base || location.origin, null);
  queryClient.clear();
  // the plaintext copy only leaves the disk when this page lets go of it, and a reload also leaves nothing of it in memory
  if (stillHeld) location.reload();
}
// the server no longer accepts the saved token (signed out elsewhere, or expired): forget it too
// The queued changes stay under that account's name: signing in as the same person picks them up again.
// The copy closes too, at once: another person may sign in on this tab without a reload (PLAN.md §4.1).
setOnUnauthorized(() => { setToken(null); void detachReplica(); if (session.user) { forgetUnlock(session.user.id); session.user = null; keyring.clear(); openOutbox(server.value.base || location.origin, null); writeJson(KEY(), null); queryClient.clear(); } });
// Another tab's session is this tab's too (they share the cookie). When that tab ends up signed out or as someone else,
// this tab's copy and key belong to the wrong session: start over.
addEventListener("storage", (e) => {
  if (e.key !== KEY() || !session.user) return;
  let next: string | undefined;
  try { next = JSON.parse(e.newValue ?? "null")?.user?.id; } catch { /* treated as signed out */ }
  if (next !== session.user.id) location.reload();
});
