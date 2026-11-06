// Files of the journal (photos, recordings). A server only ever holds them sealed: httpTransport seals a file on its
// way up (client.ts), and it is opened here on its way back and handed to the screens as an object URL. A URL holds
// the open file, so all of them go when the journal locks.
import { isSealed, unsealColumnBytes } from "@somnium/shared";
import { LockedError } from "@somnium/engine/sealed-api";
import { api, ApiError, fetchFile, isLocalDevice } from "./client";
import { keyring } from "../core/keyring";

const urls = new Map<string, string>();
const forgetAll = () => { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); };
keyring.onChange((open) => { if (!open) forgetAll(); });

/** Stores a file, on a dream if one is given. Sealing happens in the transport, so no caller can skip it. */
export const uploadMedia = (file: Blob, dreamId?: string) =>
  api.post<{ id: string; url: string }>(dreamId ? `/media?dreamId=${encodeURIComponent(dreamId)}` : "/media", file);

async function open(id: string): Promise<Blob> {
  const r = await fetchFile(`/media/${encodeURIComponent(id)}`);
  if (!r.ok) throw new ApiError(r.status, "Can't get this file");
  const type = r.headers.get("content-type") ?? "application/octet-stream";
  if (isLocalDevice()) return new Blob([await r.arrayBuffer()], { type });
  const sealed = await r.text();
  if (!isSealed(sealed)) throw new ApiError(422, "This file can't be opened");
  const key = keyring.get();
  if (!key) throw new LockedError();
  try {
    const bytes = await unsealColumnBytes(sealed, key, "media", "data", id);
    return new Blob([bytes.slice()], { type });
  } finally { key.fill(0); }
}

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
  if (!isLocalDevice() && !keyring.isOpen()) throw new LockedError();
  const url = URL.createObjectURL(file);
  urls.set(id, url);
  return url;
}

/** Signing out: the service worker's copies of this person's files go too. They are sealed, but who has what is theirs. */
export async function forgetCachedMedia() {
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const r of await cache.keys()) if (new URL(r.url).pathname.startsWith("/api/media/")) await cache.delete(r);
    }
  } catch { /* no cache here */ }
}
