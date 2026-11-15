// The speech-to-text worker (LDJ-176): Whisper tiny.en run by Transformers.js on its WebAssembly engine, single-threaded
// (no cross-origin isolation needed). It is started by core/transcribe.ts only when someone taps "Transcribe on this device",
// and gets every file it needs handed over (fetched from the person's own server and checked there): nothing in here
// reaches the network. Transformers.js asks for its files through fetch, so fetch in this worker answers from those
// files, or "not found". The audio and the text stay in this worker's memory, which core/transcribe.ts lets go of.
// (typed by hand: the project's types are the page's, and a webworker lib reference would change them for every file)
const scope = self as unknown as { fetch: typeof fetch; postMessage(m: unknown): void; onmessage: ((e: MessageEvent) => void) | null };
const files = new Map<string, ArrayBuffer>();
const own = async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const name = [...files.keys()].find((f) => url.endsWith("/" + f));
  return name ? new Response(files.get(name)!, { status: 200 }) : new Response(null, { status: 404 });
};
scope.fetch = own as typeof fetch;

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
let asr: Asr | null = null;

scope.onmessage = async (e: MessageEvent<{ id: number; type: "load"; files: Record<string, ArrayBuffer>; glue: string } | { id: number; type: "run"; audio: Float32Array }>) => {
  const m = e.data;
  try {
    if (m.type === "load") {
      for (const [k, v] of Object.entries(m.files)) files.set(k, v);
      const { env, pipeline } = await import("@huggingface/transformers");
      // files from this worker's own fetch only: never the Hugging Face Hub, never a browser cache of its own
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = "/stt/";
      env.useBrowserCache = false;
      const wasm = env.backends.onnx.wasm!;
      wasm.numThreads = 1;
      wasm.proxy = false;
      // the engine from the bytes handed over, and its loader script from the app's own files: never from a CDN
      wasm.wasmPaths = { mjs: m.glue };
      wasm.wasmBinary = files.get("ort-wasm-simd-threaded.wasm");
      asr = (await pipeline("automatic-speech-recognition", "whisper-tiny.en", { dtype: "q8", device: "wasm" })) as unknown as Asr;
      files.clear(); // the model is in the engine now
      scope.postMessage({ id: m.id, ok: true });
    } else {
      if (!asr) throw new Error("The speech model isn't loaded");
      // voice notes are up to 5 minutes: Whisper hears 30 seconds at a time, overlapping so no word is cut in two
      const out = await asr(m.audio, { chunk_length_s: 30, stride_length_s: 5 });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "";
      scope.postMessage({ id: m.id, ok: true, text });
    }
  } catch (err) {
    scope.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
