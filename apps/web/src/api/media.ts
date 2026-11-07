// Files of the journal (photos, recordings). A server only ever holds them sealed: httpTransport seals a file on its
// way up (client.ts), and it is opened here on its way back and handed to the screens as an object URL. A URL holds
// the open file, so all of them go when the journal locks.
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { isSealed, unsealColumnBytes, type Media } from "@somnium/shared";
import { LockedError } from "@somnium/engine/sealed-api";
import { api, ApiError, fetchFile, isLocalDevice } from "./client";
import { keyring } from "../core/keyring";
import { queryClient } from "./live";

const urls = new Map<string, string>();
const forgetAll = () => { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); };
keyring.onChange((open) => { if (!open) forgetAll(); });

/** Stores a file, on a dream if one is given. Sealing happens in the transport, so no caller can skip it.
 *  kind: "sketch" tells a drawing from a photo (both are pictures); duration: a recording's length in seconds. */
export const uploadMedia = (file: Blob, dreamId?: string, extra: { kind?: "sketch"; duration?: number } = {}) => {
  const qs = new URLSearchParams();
  if (dreamId) qs.set("dreamId", dreamId);
  if (extra.kind) qs.set("kind", extra.kind);
  if (extra.duration != null) qs.set("duration", String(Math.round(extra.duration)));
  const s = qs.toString();
  return api.post<{ id: string; url: string }>(s ? `/media?${s}` : "/media", file);
};

// ----- a dream's files (LDJ-20). The list and the read text come from the server (/media is server-only in
// replica.ts, as the files are); the transport opens the sealed text on the way in and seals it on the way out. -----
export type MediaRow = Pick<Media, "id" | "dreamId" | "kind" | "mime" | "size" | "duration" | "ocrText" | "createdAt">;
const key = (dreamId: string) => ["dreams", "media", dreamId];
/** A dream's photos, sketches and recordings, oldest first. Filed under "dreams", so any change to a dream reloads it. */
export const useDreamMedia = (dreamId: () => string, enabled: () => boolean) =>
  useQuery({ queryKey: computed(() => key(dreamId())), enabled: computed(enabled), queryFn: () => api.get<MediaRow[]>("/media", { dreamId: dreamId() }) });
const refresh = (dreamId: string) => queryClient.invalidateQueries({ queryKey: key(dreamId) });
export async function addMedia(dreamId: string, file: Blob, extra?: { kind?: "sketch"; duration?: number }) {
  const r = await uploadMedia(file, dreamId, extra);
  await refresh(dreamId);
  return r;
}
export async function removeMedia(m: MediaRow) {
  await api.del(`/media/${m.id}`);
  const u = urls.get(m.id); if (u) { URL.revokeObjectURL(u); urls.delete(m.id); }
  if (m.dreamId) await refresh(m.dreamId);
}
/** Keeps the text read from a photo on its row, sealed. */
export async function saveOcrText(m: MediaRow, text: string) {
  await api.put(`/media/${m.id}`, { ocrText: text });
  if (m.dreamId) await refresh(m.dreamId);
}

async function open(id: string): Promise<Blob> {
  const r = await fetchFile(`/media/${encodeURIComponent(id)}`);
  if (!r.ok) throw new ApiError(r.status, "Can't get this file");
  const type = r.headers.get("content-type") ?? "application/octet-stream";
  const buf = await r.arrayBuffer();
  const sealed = new TextDecoder().decode(buf);
  // a local account's file from before it had a password is kept as it was (LDJ-53); a server's never is
  if (!isSealed(sealed)) { if (isLocalDevice()) return new Blob([buf], { type }); throw new ApiError(422, "This file can't be opened"); }
  const key = keyring.get();
  if (!key) throw new LockedError();
  try {
    const bytes = await unsealColumnBytes(sealed, key, "media", "data", id);
    return new Blob([bytes.slice()], { type });
  } finally { key.fill(0); }
}

/** The opened file itself, for reading on this device (the text of a photo). The page's own rules (connect-src)
 *  don't let it fetch its blob: URLs, so this opens it again rather than reading the URL back. */
export const mediaBlob = (id: string) => open(id);

/** "media:<id>" (or an id) → a URL the screens can show. A local account's data: URL and any other address pass as they are. */
export async function mediaObjectUrl(src: string | null | undefined): Promise<string> {
  if (!src) return "";
  // a local account (Android) keeps files inside its database as data: URLs
  if (src.startsWith("media:data:")) return src.slice(6);
  if (src.startsWith("data:") || src.startsWith("blob:") || /^https?:/.test(src)) return src;
  const id = src.startsWith("media:") ? src.slice(6) : src;
  const have = urls.get(id);
  if (have) return have;
  const file = await open(id);
  // locked while the file was opening: the lock has already let go of every URL, and a new one would hold the open file past it
  if (!keyring.isOpen()) throw new LockedError();
  const url = URL.createObjectURL(file);
  urls.set(id, url);
  return url;
}

/** Signing out: the service worker's copies of this person's files go too. They are sealed, but who has what is theirs. */
/** origin: only one server's (an account removed from the app while another server's account stays). */
export async function forgetCachedMedia(origin?: string) {
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const r of await cache.keys()) { const u = new URL(r.url); if (u.pathname.startsWith("/api/media/") && (!origin || u.origin === origin)) await cache.delete(r); }
    }
  } catch { /* no cache here */ }
}
