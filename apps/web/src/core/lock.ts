// The app lock on this device (PLAN.md §4.3): feeds real events to the decisions in @somnium/shared (lockStep) and
// carries out what they ask. Locked on every start; App.vue keeps every shell unmounted while `lock.locked`.
//
// Locking drops the data key and everything decrypted that this module can reach (the query cache, open questions,
// toasts). Screens are unmounted by App.vue, so an unsaved form is lost on lock: a page that holds text worth keeping
// has to save as the person types.
import { nextTick, reactive, watch } from "vue";
import { lockSettingsFrom, lockStep, startLockState, wrongTriesFrom, wrongTryWaitLeft, type LockEvent, type LockSettings } from "@somnium/shared";
import { usingHttp } from "../api/client";
import { invalidate, queryClient } from "../api/live";
import { startReplica } from "../api/replica";
import { closeQuestions, openQuestions } from "./ask";
import { keyring } from "./keyring";
import { readJson, writeJson } from "./prefs";
import { isLocalAccount, session } from "./session";
import { muteToasts } from "./toast";

const SETTINGS = "somniumLock", TRIES = "somniumLockTries";

let state = startLockState(Date.now(), readJson(TRIES, 0));
const saveTries = () => writeJson(TRIES, { count: state.wrongTries, lastAt: state.lastWrongAt });
saveTries(); // a clock found to have gone back is settled here, for the next start too
/** waitMs: how long until the next try may be made. */
export const lock = reactive<{ locked: boolean; wrongTries: number; waitMs: number; settings: LockSettings }>({
  locked: true, wrongTries: state.wrongTries, waitMs: wrongTryWaitLeft(state, Date.now()), settings: lockSettingsFrom(readJson(SETTINGS, null)),
});
muteToasts(true);

function dispatch(e: LockEvent) {
  const was = state.locked, triesWere = state.wrongTries, lastWas = state.lastWrongAt;
  const r = lockStep(state, e, lock.settings);
  state = r.state;
  lock.locked = state.locked;
  lock.wrongTries = state.wrongTries;
  lock.waitMs = wrongTryWaitLeft(state, e.at);
  if (triesWere !== state.wrongTries || lastWas !== state.lastWrongAt) saveTries();
  if (r.actions.includes("clearKey")) keyring.clear();
  if (!was && state.locked) onLocked();
  if (was && !state.locked) { muteToasts(false); openQuestions(); }
}

function onLocked() {
  muteToasts(true);
  queryClient.clear();
  // a question left open may name what it is about; every asker treats "no answer" as cancel
  closeQuestions();
  // a closing sheet leaves a copy of itself on the page for its animation (components/Sheet.vue): not this time
  void nextTick(() => { for (const ghost of document.querySelectorAll(".scr.leaving")) ghost.remove(); });
}

/** The password was just proven at sign-in, or the journal just opened on the lock screen. */
export function markUnlocked() {
  dispatch({ type: "unlocked", at: Date.now() });
  void openCopyIfNone();
  // unlocked while the app was being left (the slow key derivation): the time away starts now
  if (document.visibilityState === "hidden") { hold(1500); dispatch({ type: "away", at: Date.now() }); }
}
// The first copy of the journal needs the key. Every start is locked, so if the one made at sign-in never finished, this
// is the only moment left to make it. Not for a local account, which is its own copy.
async function openCopyIfNone() {
  const user = session.user;
  if (!user || !usingHttp() || (await isLocalAccount())) return;
  if (await startReplica(user)) invalidate(["*"]);
}
/** The password was right, but the lock screen has one more step before the journal shows: the idle time runs meanwhile. */
export const keyOpenedOnLockScreen = () => dispatch({ type: "keyOpened", at: Date.now() });
export const lockNow = () => dispatch({ type: "lock", at: Date.now() });
// Every tab writes the count as it changes, so what is stored is the truth: another tab may have counted a try, or unlocked.
function takeStoredTries() {
  const saved = readJson<unknown>(TRIES, null);
  if (saved === null) return; // storage refused: this tab's own count stands
  const t = wrongTriesFrom(saved, Date.now());
  state = { ...state, wrongTries: t.count, lastWrongAt: t.lastAt };
  // settled once and written back: taken again from the old value each time, a clock moved back would restart the wait for good
  if ((saved as { lastAt?: unknown }).lastAt !== t.lastAt) saveTries();
}
/** How long until the next try may be made, in ms. Checked before each try, so one made during a wait never looks at the password. */
export function wrongTryWait(): number {
  takeStoredTries();
  lock.wrongTries = state.wrongTries;
  lock.waitMs = wrongTryWaitLeft(state, Date.now());
  return lock.waitMs;
}
/** A wrong password, or a device verification that answered with the wrong thing. */
export function wrongTry() {
  takeStoredTries();
  dispatch({ type: "wrong", at: Date.now() });
}
export function setLockSettings(s: Partial<LockSettings>) {
  lock.settings = lockSettingsFrom({ ...lock.settings, ...s });
  writeJson(SETTINGS, lock.settings);
}

const hold = (ms: number) => dispatch({ type: "hold", at: Date.now(), ms });
/** A system dialog is about to open (the app loses focus, or is hidden on a phone) and the person hasn't left. */
export const holdForDialog = () => hold(Number.POSITIVE_INFINITY);
const release = () => dispatch({ type: "release", at: Date.now() });
/** The device's verification dialog: leaving a moment after it closes, for the browser to report being back. */
export async function whileVerifying<T>(run: () => Promise<T>): Promise<T> {
  holdForDialog();
  try { return await run(); } finally { hold(1500); }
}

let started = false;
export function startLock() {
  if (started) return;
  started = true;
  const now = () => Date.now();
  const isDesktopApp = !!(globalThis as { somniumDesktop?: boolean }).somniumDesktop;
  const visible = () => document.visibilityState === "visible";

  document.addEventListener("visibilitychange", () => dispatch({ type: visible() ? "back" : "away", at: now() }));
  addEventListener("pagehide", () => dispatch({ type: "away", at: now() }));
  // brought back from the browser's page cache: this counts as a start
  addEventListener("pageshow", (e) => { if (e.persisted) lockNow(); });
  // In a browser, focus moves to the address bar or a password manager all the time, so only hiding counts there.
  if (isDesktopApp) addEventListener("blur", () => dispatch({ type: "away", at: now() }));
  addEventListener("focus", () => {
    if (visible()) dispatch({ type: "back", at: now() });
    release();
  });

  // a file picker or the camera takes the app out of sight; the screen behind it must still be there to get the answer
  document.addEventListener("click", (e) => { if ((e.target as Element | null)?.matches?.('input[type="file"]')) holdForDialog(); }, true);
  document.addEventListener("change", (e) => { if ((e.target as Element | null)?.matches?.('input[type="file"]')) release(); }, true);
  document.addEventListener("cancel", (e) => { if ((e.target as Element | null)?.matches?.('input[type="file"]')) release(); }, true);

  let lastActivity = 0;
  const active = () => { const t = now(); if (t - lastActivity > 1000) { lastActivity = t; dispatch({ type: "activity", at: t }); } };
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) addEventListener(ev, active, { capture: true, passive: true });
  // a hidden tab's timers are slowed down to about one a minute, which only makes the key last that much longer;
  // coming back checks the time itself
  setInterval(() => { takeStoredTries(); dispatch({ type: "tick", at: now() }); }, 1000);

  // whatever ends the session (signing out, the server refusing it), the next one starts locked with a clean count,
  // and nothing of this one stays on the page over the sign-in screen. Toasts and questions stay off until the next unlock.
  watch(() => session.user?.id, (id) => {
    if (id) return;
    state = startLockState(now());
    lock.locked = true; lock.wrongTries = 0; lock.waitMs = 0;
    saveTries();
    onLocked();
  }, { flush: "sync" });
}
