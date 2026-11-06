// Logging a reality check (PLAN.md §6.4, §9). Only kind, outcome, prompted and time: none of these is sealed, so the
// /check screen can do it without the journal being unlocked. Saved here at once and sent when the server can be
// reached (outbox: no connection, or the key closed while the device's copy waits to sync).
import { checkKindOf, type CheckOutcome } from "@somnium/shared";
import { uuidv7 } from "@somnium/engine/sealed-api";
import { send } from "./outbox";
import { ApiError, httpTransport, isLocalDevice } from "./client";
import { keyring } from "../core/keyring";
import { invalidate } from "./live";

export async function logCheck(checkId: string, outcome: CheckOutcome, prompted: boolean): Promise<{ id: string; queued: boolean }> {
  const id = uuidv7();
  const body = { id, at: new Date().toISOString(), kind: checkKindOf(checkId), outcome, prompted };
  let queued = false;
  if (!isLocalDevice() && !keyring.isOpen()) {
    // locked: the device's copy can't send a journal table without the key, so this row (nothing sealed in it, the
    // note stays empty) goes straight to the server. The copy picks it up with the next sync after unlocking.
    try { await httpTransport.request("POST", "/reality-checks", body); }
    catch (e) { if (!(e instanceof ApiError && e.status === 0)) throw e; queued = (await send("post", "/reality-checks", body)) === null; }
  } else queued = (await send("post", "/reality-checks", body)) === null;
  invalidate(["checks"]);
  return { id, queued };
}
