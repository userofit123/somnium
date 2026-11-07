// The journal's files (PLAN.md §6.2, LDJ-20): photos of paper pages, sketches and voice notes. Pure rules here; the
// screens that use them are in apps/web (components/journal/DreamMedia.vue). Each kind is an optional feature.

/** A photo's longest side once it is on the device's way up: enough to read a handwritten page, small enough to send. */
export const PHOTO_MAX_SIDE = 2048;
/** A voice note stops by itself at this length (seconds). */
export const VOICE_MAX_SECONDS = 300;

/** The size a picture is drawn at so its longest side is at most `max`, keeping its shape. Never made larger. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Which of the journal's file features are on (each one is off and absent until switched on in Settings → Features). */
export function mediaFeatures(features: Record<string, boolean | undefined> | null | undefined) {
  const photos = !!features?.photos, sketches = !!features?.sketches, voice = !!features?.voiceNotes;
  return { photos, sketches, voice, any: photos || sketches || voice };
}

// ----- JPEG metadata -----
// A phone's photo carries EXIF: where it was taken (GPS), when, and on what. The app re-encodes every photo through a
// canvas, which writes none, and then passes the result through stripJpegMetadata as well, so a browser that ever
// copied metadata across still can't send it. Only the JFIF header (APP0) and the image itself are kept.

const isApp = (m: number) => m >= 0xe1 && m <= 0xef; // APP1 (EXIF, XMP) to APP15 (APP0 is JFIF and stays)
const COM = 0xfe, SOS = 0xda;

/** The markers of a JPEG's header segments, in order, up to the image data. Throws on anything that isn't a JPEG. */
export function jpegSegments(bytes: Uint8Array): { marker: number; start: number; end: number }[] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Not a JPEG");
  const out: { marker: number; start: number; end: number }[] = [];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) throw new Error("Broken JPEG");
    const marker = bytes[i + 1]!;
    if (marker === 0xff) { i++; continue; } // fill byte
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (len < 2 || i + 2 + len > bytes.length) throw new Error("Broken JPEG");
    out.push({ marker, start: i, end: i + 2 + len });
    if (marker === SOS) break;
    i += 2 + len;
  }
  return out;
}

/** Whether a JPEG carries any metadata segment (EXIF, XMP, ICC, a comment...). */
export const jpegHasMetadata = (bytes: Uint8Array): boolean => jpegSegments(bytes).some((s) => isApp(s.marker) || s.marker === COM);

/** The same JPEG without its metadata segments (APP1-APP15 and comments). Everything from the image data on is kept. */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const segs = jpegSegments(bytes);
  const sos = segs.find((s) => s.marker === SOS);
  if (!sos) throw new Error("Broken JPEG");
  const keep = segs.filter((s) => !isApp(s.marker) && s.marker !== COM && s.marker !== SOS);
  const size = 2 + keep.reduce((n, s) => n + s.end - s.start, 0) + (bytes.length - sos.start);
  const out = new Uint8Array(size);
  out[0] = 0xff; out[1] = 0xd8;
  let o = 2;
  for (const s of keep) { out.set(bytes.subarray(s.start, s.end), o); o += s.end - s.start; }
  out.set(bytes.subarray(sos.start), o);
  return out;
}
