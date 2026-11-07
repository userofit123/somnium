import { describe, expect, it } from "vitest";
import { FEATURES, FEATURE_DEFAULTS, READY_FEATURES } from "./features";
import { PHOTO_MAX_SIDE, fitWithin, jpegHasMetadata, jpegSegments, mediaFeatures, stripJpegMetadata } from "./media";

// An 8 × 8 JPEG made with Pillow, carrying EXIF with a camera name and a GPS position (51°30'12.5"N 0°7'39"W).
const GPS_JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/4QCcRXhpZgAATU0AKgAAAAgAAgEPAAIAAAAIAAAAJoglAAQAAAABAAAALgAAAABUZXN0Q2FtAAAEAAEAAgAAAAJOAAAAAAIABQAAAAMAAABkAAMAAgAAAAJXAAAAAAQABQAAAAMAAAB8AAAAAAAAADMAAAABAAAAHgAAAAEAAAAZAAAAAgAAAAAAAAABAAAABwAAAAEAAAAnAAAAAf/bAEMAEAsMDgwKEA4NDhIREBMYKBoYFhYYMSMlHSg6Mz08OTM4N0BIXE5ARFdFNzhQbVFXX2JnaGc+TXF5cGR4XGVnY//bAEMBERISGBUYLxoaL2NCOEJjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY//AABEIAAgACAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AKlFFFeyan//2Q==";
const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));
const has = (hay: Uint8Array, needle: string) => Buffer.from(hay).includes(Buffer.from(needle, "latin1"));

describe("EXIF stripping", () => {
  it("takes the GPS position and the rest of the EXIF out of a photo", () => {
    const src = bytes(GPS_JPEG);
    expect(has(src, "Exif")).toBe(true);
    expect(has(src, "TestCam")).toBe(true);
    expect(jpegHasMetadata(src)).toBe(true);
    const out = stripJpegMetadata(src);
    expect(has(out, "Exif")).toBe(false);
    expect(has(out, "TestCam")).toBe(false);
    // the GPS IFD tag (0x8825) lives in the EXIF segment: no APP1 at all is left
    expect(jpegSegments(out).some((s) => s.marker === 0xe1)).toBe(false);
    expect(jpegHasMetadata(out)).toBe(false);
  });
  it("keeps the picture itself whole", () => {
    const src = bytes(GPS_JPEG), out = stripJpegMetadata(src);
    expect([out[0], out[1]]).toEqual([0xff, 0xd8]);
    expect([out[out.length - 2], out[out.length - 1]]).toEqual([0xff, 0xd9]);
    const markers = jpegSegments(out).map((s) => s.marker);
    for (const m of [0xe0, 0xdb, 0xc0, 0xc4, 0xda]) expect(markers).toContain(m); // JFIF, tables, frame, Huffman, scan
    // image data from the scan on is byte for byte the same
    const sos = (b: Uint8Array) => b.subarray(jpegSegments(b).find((s) => s.marker === 0xda)!.start);
    expect(Buffer.from(sos(out)).equals(Buffer.from(sos(src)))).toBe(true);
    expect(stripJpegMetadata(out)).toEqual(out); // nothing more to take
  });
  it("refuses what isn't a JPEG rather than passing it on", () => {
    expect(() => stripJpegMetadata(new TextEncoder().encode("GIF89a..."))).toThrow();
    expect(() => stripJpegMetadata(bytes(GPS_JPEG).subarray(0, 40))).toThrow();
  });
});

describe("photo size cap", () => {
  it("brings the longest side down to the cap, keeping the shape", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: PHOTO_MAX_SIDE, height: 1536 });
    expect(fitWithin(3000, 6000)).toEqual({ width: 1024, height: PHOTO_MAX_SIDE });
    expect(fitWithin(2048, 2048)).toEqual({ width: 2048, height: 2048 });
  });
  it("never makes a small picture larger", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it("copes with empty and odd sizes", () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(10000, 1)).toEqual({ width: 2048, height: 1 });
  });
});

describe("feature gating", () => {
  it("photos, sketches and voice notes are built, and off for a new account", () => {
    for (const id of ["photos", "sketches", "voiceNotes"]) {
      expect(READY_FEATURES.some((f) => f.id === id)).toBe(true);
      expect(FEATURE_DEFAULTS[id]).toBe(false);
      expect(FEATURES.find((f) => f.id === id)?.group).toBe("Journal");
    }
  });
  it("shows nothing until a feature is switched on, and only that one", () => {
    expect(mediaFeatures(FEATURE_DEFAULTS)).toEqual({ photos: false, sketches: false, voice: false, any: false });
    expect(mediaFeatures(undefined).any).toBe(false);
    expect(mediaFeatures({ ...FEATURE_DEFAULTS, photos: true })).toEqual({ photos: true, sketches: false, voice: false, any: true });
    expect(mediaFeatures({ ...FEATURE_DEFAULTS, voiceNotes: true }).voice).toBe(true);
  });
});
