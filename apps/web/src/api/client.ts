// Talking to the data: over HTTPS to a server, or (for a local account in the Android app) to the engine inside the app.
// Screens never know which: they call api.get/post/put/del.
import { ref } from "vue";
import { sealColumn } from "@somnium/shared";
import { LockedError, isJournalRoute, openResponse, previewImport, sealRequest, uuidv7 } from "@somnium/engine/sealed-api";
import { keyring } from "../core/keyring";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** wait: how long to wait for an answer before counting it as no connection, in ms (0 = as long as it takes). */
export interface RequestOptions { wait?: number }
export interface Transport { request(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<unknown> }

/** The server this app talks to ("" = the one it was loaded from) and, in the apps, a bearer token instead of the cookie. */
export const server = ref<{ base: string; token: string | null }>({ base: "", token: null });

const ANSWER_WAIT = 20_000;

const authHeaders = () => {
  const headers: Record<string, string> = { "x-somnium": "1" };
  if (server.value.token) headers.authorization = `Bearer ${server.value.token}`;
  return headers;
};

/** A file from the server exactly as it is stored there (apps/web/src/api/media.ts opens it). */
export const fetchFile = (path: string) => fetch(server.value.base + "/api" + path, { headers: authHeaders(), credentials: "include" });

const rawTransport: Transport = {
  async request(method, path, body, opts) {
    const headers = authHeaders();
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
      if (r.status === 401) onUnauthorized();
      throw new ApiError(r.status, (data as any)?.error ?? `Request failed (${r.status})`);
    }
    return data;
  },
};

// A local account in the desktop app talks to the server inside the app, over this same transport. Its data stays on
// the device as plaintext (docs/security.md), so nothing is sealed. Off until it is known to be one: when in doubt, seal.
let localDevice = false;
export const setLocalDevice = (on: boolean) => { localDevice = on; };
export const isLocalDevice = () => localDevice;

/**
 * Everything that goes to a server goes through here, so no screen can send a sealed column in the clear, with or
 * without the device's copy in use (packages/engine/src/sync/sealedApi.ts). Without the key, journal requests are
 * refused here rather than sent. Settings, sign-in, admin and version requests carry nothing sealed and pass as they are.
 */
export const httpTransport: Transport = {
  async request(method, path, body, opts) {
    if (localDevice) return rawTransport.request(method, path, body, opts);
    const plainPath = path.split("?")[0];
    if (method === "POST" && plainPath === "/import/preview") {
      const preview = previewImport(body);
      if (!preview) throw new ApiError(400, "This is not a Somnium export");
      return preview;
    }
    const isUpload = method === "POST" && plainPath === "/media";
    if (!isUpload && !isJournalRoute(path)) return rawTransport.request(method, path, body, opts);
    const key = keyring.get();
    if (!key) throw new LockedError();
    try {
      if (isUpload) {
        // the file is bound to its row like any sealed value, so the id is made here and sent along
        const file = body as Blob, id = uuidv7();
        const sealed = await sealColumn(new Uint8Array(await file.arrayBuffer()), key, "media", "data", id);
        return await rawTransport.request(method, `${path}${path.includes("?") ? "&" : "?"}id=${id}`, new Blob([sealed], { type: file.type || "application/octet-stream" }), opts);
      }
      const out = await sealRequest(method, path, body, key, (p) => rawTransport.request("GET", p));
      const answer = await rawTransport.request(method, path, method === "GET" || method === "DELETE" ? body : out, opts);
      const { data, unopened } = await openResponse(path, answer, key);
      if (unopened) console.warn(`${unopened} row${unopened === 1 ? "" : "s"} from the server couldn't be opened`);
      return data;
    } finally { key.fill(0); }
  },
};

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
