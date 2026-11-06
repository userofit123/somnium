// UUIDv7: time-ordered ids that cannot be guessed, made on any device (so offline-created rows never clash).
export function uuidv7(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const ms = Date.now();
  b[0] = Math.floor(ms / 2 ** 40) & 255;
  b[1] = Math.floor(ms / 2 ** 32) & 255;
  b[2] = (ms >>> 24) & 255;
  b[3] = (ms >>> 16) & 255;
  b[4] = (ms >>> 8) & 255;
  b[5] = ms & 255;
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
