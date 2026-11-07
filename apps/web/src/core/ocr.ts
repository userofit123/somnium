// Reading the text of a photographed journal page (PLAN.md §7.1 step 4, LDJ-20), on this device. This module is only
// ever imported when someone taps "Read the text", so tesseract.js, its engine and the English model stay out of the
// main bundle. All of them are built into the app's own /assets (no CDN): the URLs below are files Vite copies there,
// and the service worker keeps them once used (public/sw.js), so reading works offline after the first time.
// Tesseract runs in its own Web Worker, so the editor stays responsive while it reads.
import { createWorker, type Worker } from "tesseract.js";
import workerUrl from "tesseract.js/dist/worker.min.js?url";
import coreSimdUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import coreUrl from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import engUrl from "virtual:ocr-eng";

export interface OcrProgress { step: string; progress: number }

// WebAssembly SIMD (every current browser): the faster engine; otherwise the plain one. Only the chosen one is fetched.
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const simd = () => { try { return WebAssembly.validate(SIMD_PROBE); } catch { return false; } };

const STEPS: Record<string, string> = {
  "loading tesseract core": "Getting the reader ready", "initializing tesseract": "Getting the reader ready",
  "loading language traineddata": "Loading the English model", "initializing api": "Getting the reader ready",
  "recognizing text": "Reading the text",
};

let worker: Promise<Worker> | null = null;
let listener: ((p: OcrProgress) => void) | null = null;

function start(): Promise<Worker> {
  worker ??= (async () => {
    await Promise.resolve();
    // tesseract fetches the model as <langPath>/eng.traineddata.gz: our own copy (vite.config.ts ocrModel), never its CDN
    return createWorker("eng", 1 /* LSTM only */, {
      workerPath: workerUrl, corePath: simd() ? coreSimdUrl : coreUrl,
      langPath: new URL(engUrl.slice(0, engUrl.lastIndexOf("/")), location.href).href,
      workerBlobURL: false, // the worker script from our own origin, not a blob: copy of it
      cacheMethod: "none", // the service worker already keeps the model; nothing goes in IndexedDB
      gzip: true, legacyCore: false, legacyLang: false,
      logger: (m) => listener?.({ step: STEPS[m.status] ?? "Reading", progress: typeof m.progress === "number" ? m.progress : 0 }),
    });
  })().catch((e) => { worker = null; throw e; });
  return worker;
}

/** The text in a picture. One reading at a time; the worker is kept for the next photo and let go by stopOcr. */
export async function readText(image: Blob, onProgress?: (p: OcrProgress) => void): Promise<string> {
  listener = onProgress ?? null;
  try {
    // tesseract's own start never settles when a file is missing: give up rather than spin forever
    const w = await Promise.race([start(), new Promise<never>((_, no) => setTimeout(() => no(new Error("The reader couldn't start. Check the connection to your server and try again.")), 120_000))]);
    const { data } = await w.recognize(image);
    return (data.text ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally { listener = null; }
}

/** Lets the worker go (the editor closed, or the journal locked): it holds the page's text in its memory. */
export async function stopOcr() {
  const w = worker; worker = null;
  if (w) try { await (await w).terminate(); } catch { /* it never started */ }
}
