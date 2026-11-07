// A photo on its way to a dream (LDJ-20): drawn again through a canvas at most PHOTO_MAX_SIDE on its longest side and
// saved as a new JPEG (WebP when the browser can't). A canvas writes no EXIF, so the place, time and camera a phone
// stores in a photo never leave the device; stripJpegMetadata then makes sure of it. A file that can't be drawn is
// refused, never sent as it came.
import { fitWithin, stripJpegMetadata, PHOTO_MAX_SIDE } from "@somnium/shared";

const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((ok) => c.toBlob(ok, type, q));

export async function cleanPhoto(file: Blob, max = PHOTO_MAX_SIDE): Promise<Blob> {
  let bmp: ImageBitmap;
  // the photo's own rotation is applied while drawing, so dropping the EXIF that held it doesn't turn the page sideways
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("This picture can't be read on this device"); }
  try {
    const { width, height } = fitWithin(bmp.width, bmp.height, max);
    if (!width) throw new Error("This picture is empty");
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const g = c.getContext("2d");
    if (!g) throw new Error("This picture can't be read on this device");
    g.fillStyle = "#fff"; g.fillRect(0, 0, width, height); // a transparent PNG becomes a page on white, not on black
    g.drawImage(bmp, 0, 0, width, height);
    const jpeg = await toBlob(c, "image/jpeg", 0.88);
    if (jpeg && jpeg.type === "image/jpeg") return new Blob([stripJpegMetadata(new Uint8Array(await jpeg.arrayBuffer())).slice()], { type: "image/jpeg" });
    const webp = await toBlob(c, "image/webp", 0.88);
    if (webp && webp.type === "image/webp") return webp;
    throw new Error("This picture can't be saved on this device");
  } finally { bmp.close(); }
}
