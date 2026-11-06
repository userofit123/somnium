// Talking to the data: over HTTPS to a server, or (for a local account in the Android app) to the engine inside the app.
// Screens never know which: they call api.get/post/put/del.
import { ref } from "vue";
import { sealColumn } from "@somnium/shared";
import { LockedError, isImportPreview, isJournalRoute, isMediaUpload, openResponse, previewImport, sealRequest, uuidv7 } from "@somnium/engine/sealed-api";
import { keyring } from "../core/keyring";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** wait: how long to wait for an answer before counting it as no connection, in ms (0 = as long as it takes). headers: on top of the usual ones. */
export interface RequestOptions { wait?: number; headers?: Record<string, string> }
export interface Transport { request(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<unknown> }

/** The server this app talks to ("" = the one it was loaded from) and, in the apps, a bearer token instead of the cookie. */
export const server = ref<{ base: string; token: string | null }>({ base: "", token: null });

const ANSWER_WAIT = 20_000;

// Moves on when a session begins or ends. A request made under an earlier one may still answer 401 long after the next
// person has signed in on this tab, and that says nothing about their session.
let sessionEra = 0;
export const newSessionEra = () => { sessionEra++; };

const authHeaders = () => {
  const headers: Record<string, string> = { "x-somnium": "1" };
  if (server.value.token) headers.authorization = `Bearer ${server.value.token}`;
  return headers;
};

/** A file from the server exactly as it is stored there (apps/web/src/api/media.ts opens it). */
export const fetchFile = (path: string) => fetch(server.value.base + "/api" + path, { headers: authHeaders(), credentials: "include" });

const rawTransport: Transport = {
  async request(method, path, body, opts) {
    const askedIn = sessionEra;
    const headers = { ...authHeaders(), ...opts?.headers };
    let payload: BodyInit | undefined;
    if (body instanceof Blob) { payload = body; headers["content-type"] = body.type || "application/octet-stream"; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers["content-type"] = "application/json"; }
    let r: Response;
    // A switched-off server (behind Tailscale, on the LAN) often never answers instead of refusing, and the request
    // would hang for minutes: no answer at all within a while counts as no connection. Uploads can take longer.
    const stop = new AbortController();
    const wait = body instanceof Blob ? 0 : opts?.wait ?? ANSWER_WAIT;
    const timer = wait ? setTimeout(() => stop.abort(), wait) : 0;
    try {
      r = await Promise.race([
        fetch(server.value.base + "/api" + path, { method, headers, body: payload, credentials: "include", signal: stop.signal }),
        // the Android app's native fetch may not honour the signal
        new Promise<never>((_, no) => stop.signal.addEventListener("abort", () => no(stop.signal.reason))),
      ]);
    } catch {
      throw new ApiError(0, "Can't reach the server. Check your connection.");
    } finally { clearTimeout(timer); }
    // the server is down behind its proxy (Caddy, the desktop app): the same as no connection
    if ([502, 503, 504].includes(r.status)) throw new ApiError(0, "Can't reach the server right now.");
    const text = await r.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!r.ok) {
      if (r.status === 401 && askedIn === sessionEra) onUnauthorized();
      throw new ApiError(r.status, (data as any)?.error ?? `Request failed (${r.status})`);
    }
    return data;
  },
};

// A local account in the desktop app talks to the server inside the app, over this same transport, and is sealed the
// same way (LDJ-53): its database holds ciphertext in the sealed columns, like a server's. Known here so the screens
// can tell the journal is on this device (journal.ts onDevice) and so files written before sealing still open.
let localDevice = false;
export const setLocalDevice = (on: boolean) => { localDevice = on; };
export const isLocalDevice = () => localDevice;

/** One step's own copy of the key, zeroed when the step ends: none is held while waiting for the server. */
async function withKeyCopy<T>(step: (key: Uint8Array) => Promise<T>): Promise<T> {
  const key = keyring.get();
  if (!key) throw new LockedError();
  try { return await step(key); } finally { key.fill(0); }
}

/** The one journal write allowed without the key: a new reality check from /check, which opens over the lock screen
 *  (LDJ-28). Its only sealed column, the note, must be absent; anything else still needs the key. */
const CHECK_FIELDS = new Set(["id", "at", "kind", "outcome", "prompted"]);
const isUnsealedCheck = (method: string, path: string, body: unknown) =>
  method === "POST" && path === "/reality-checks" && !!body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).every((k) => CHECK_FIELDS.has(k));

/**
 * Everything that goes to the journal's store goes through this, so no screen can send a sealed column in the clear:
 * a server, with or without the device's copy in use (packages/engine/src/sync/sealedApi.ts), and a local account's
 * own database (the desktop app's server inside the app, the Android app's engine). Without the key, journal
 * requests are refused here rather than sent. Settings, sign-in, admin and version requests carry nothing sealed and
 * pass as they are.
 */
export function sealingTransport(raw: Transport): Transport {
  return {
    async request(method, path, body, opts) {
      if (method === "POST" && isImportPreview(path)) {
        const preview = previewImport(body);
        if (!preview) throw new ApiError(400, "This is not a Somnium export");
        return preview;
      }
      const isUpload = method === "POST" && isMediaUpload(path);
      if (!isUpload && !isJournalRoute(path)) return raw.request(method, path, body, opts);
      if (!keyring.isOpen()) {
        if (isUnsealedCheck(method, path, body)) return raw.request(method, path, body, opts);
        throw new LockedError();
      }
      const opened = keyring.generation();
      const stopIfLocked = () => { if (keyring.generation() !== opened) throw new LockedError(); };
      if (isUpload) {
        // the file is bound to its row like any sealed value, so the id is made here and sent along
        const file = body as Blob, id = uuidv7();
        const bytes = new Uint8Array(await file.arrayBuffer());
        stopIfLocked();
        const sealed = await withKeyCopy((key) => sealColumn(bytes, key, "media", "data", id));
        stopIfLocked();
        return raw.request(method, `${path}${path.includes("?") ? "&" : "?"}id=${id}`, new Blob([sealed], { type: file.type || "application/octet-stream" }), opts);
      }
      const out = await withKeyCopy((key) => sealRequest(method, path, body, key, (p) => raw.request("GET", p)));
      stopIfLocked();
      const answer = await raw.request(method, path, method === "GET" || method === "DELETE" ? body : out, opts);
      stopIfLocked(); // an answer that arrives after the lock stays sealed
      const { data, unopened } = await withKeyCopy((key) => openResponse(path, answer, key));
      if (unopened) console.warn(`${unopened} row${unopened === 1 ? "" : "s"} couldn't be opened`);
      return data;
    },
  };
}
export const httpTransport: Transport = sealingTransport(rawTransport);

let transport: Transport = httpTransport;
export const usingHttp = () => transport === httpTransport;
export const setTransport = (t: Transport) => { transport = t; };
let onUnauthorized = () => {};
export const setOnUnauthorized = (fn: () => void) => { onUnauthorized = fn; };

const q = (params?: Record<string, unknown>) => {
  if (!params) return "";
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return s ? "?" + s : "";
};
export const api = {
  get: <T = any>(path: string, params?: Record<string, unknown>, opts?: RequestOptions) => transport.request("GET", path + q(params), undefined, opts) as Promise<T>,
  post: <T = any>(path: string, body?: unknown) => transport.request("POST", path, body ?? {}) as Promise<T>,
  put: <T = any>(path: string, body?: unknown) => transport.request("PUT", path, body ?? {}) as Promise<T>,
  del: <T = any>(path: string, body?: unknown) => transport.request("DELETE", path, body) as Promise<T>,
};
