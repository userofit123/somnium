// Talking to the data: over HTTPS to a server, or (for a local account in the Android app) to the engine inside the app.
// Screens never know which: they call api.get/post/put/del.
import { ref } from "vue";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** wait: how long to wait for an answer before counting it as no connection, in ms (0 = as long as it takes). */
export interface RequestOptions { wait?: number }
export interface Transport { request(method: string, path: string, body?: unknown, opts?: RequestOptions): Promise<unknown> }

/** The server this app talks to ("" = the one it was loaded from) and, in the apps, a bearer token instead of the cookie. */
export const server = ref<{ base: string; token: string | null }>({ base: "", token: null });

const ANSWER_WAIT = 20_000;

export const httpTransport: Transport = {
  async request(method, path, body, opts) {
    const headers: Record<string, string> = { "x-somnium": "1" };
    if (server.value.token) headers.authorization = `Bearer ${server.value.token}`;
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

/** Uploaded media → URL */
export function mediaUrl(src: string | null | undefined): string {
  if (!src) return "";
  // a local account (Android) keeps files inside its database as data: URLs
  if (src.startsWith("media:data:")) return src.slice(6);
  if (src.startsWith("media:")) return `${server.value.base}/api/media/${src.slice(6)}`;
  return src;
}
