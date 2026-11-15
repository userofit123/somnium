// Turning a voice note into text on this device (LDJ-176, optional feature "Transcribe voice notes"). The audio never
// leaves the device: it is opened here, decoded to 16 kHz, and handed to a worker (core/stt.worker.ts) that runs Whisper
// tiny.en. The model (about 55 MB with its engine) is built into the server's copy of the app (vite.config.ts sttModel)
// and fetched from the person's own server the first time, checked against the hashes the build wrote, and kept in this
// device's cache (Cache Storage "somnium-stt", not the service worker's: one copy, kept across app updates). The desktop
// and Android apps don't carry it, so they fetch it from the server too, which is why a local account has no
// transcription: its app has no server to get it from.
import model from "virtual:stt-model";
import { isLocalDevice, server, usingHttp } from "../api/client";

export interface SttProgress { step: string; progress: number | null }

const CACHE = "somnium-stt";

/** Offered when this build has the model and the app talks to a server, where the model is. */
export const canTranscribe = () => !!model && usingHttp() && !isLocalDevice();

const address = (name: string) => (name.endsWith(".wasm") && model!.wasmDir ? model!.wasmDir : model!.dir) + name;
const hex = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");
const openCache = async () => { try { return await caches.open(CACHE); } catch { return null; } };

/** Every file of the model: from this device's cache, or from the server (then kept). */
async function loadFiles(onProgress: (p: SttProgress) => void): Promise<Record<string, ArrayBuffer>> {
  const m = model!;
  const cache = await openCache();
  const total = Object.values(m.sizes).reduce((a, b) => a + b, 0) || 1;
  let done = 0;
  const out: Record<string, ArrayBuffer> = {};
  const keys = new Set<string>();
  for (const name of Object.keys(m.files)) {
    const key = new URL(address(name), location.href).href;
    keys.add(key);
    const kept = await cache?.match(key).catch(() => undefined);
    if (kept) { out[name] = await kept.arrayBuffer(); done += m.sizes[name] ?? 0; continue; }
    onProgress({ step: "Loading the speech model from your server", progress: done / total });
    let res: Response;
    try { res = await fetch(server.value.base + address(name), { cache: "no-store", credentials: "omit" }); }
    catch { throw new Error("Can't reach your server to load the speech model. Try again when you're connected."); }
    // a server that doesn't have it answers with the app's page
    if (!res.ok || /text\/html/.test(res.headers.get("content-type") ?? "")) throw new Error("Your server doesn't have the speech model. It may run an older version of Somnium.");
    const parts: Uint8Array[] = [];
    let got = 0;
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        parts.push(value); got += value.length;
        onProgress({ step: "Loading the speech model from your server", progress: (done + got) / total });
      }
    } else parts.push(new Uint8Array(await res.arrayBuffer()));
    const bytes = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let at = 0;
    for (const p of parts) { bytes.set(p, at); at += p.length; }
    if ((await hex(bytes.buffer)) !== m.files[name]) throw new Error("The speech model didn't arrive whole. Try again.");
    out[name] = bytes.buffer;
    done += m.sizes[name] ?? bytes.length;
    // a full device keeps nothing: it loads again next time
    try { await cache?.put(key, new Response(bytes.slice().buffer)); } catch { /* no room */ }
  }
  // an earlier version's model goes once this one is kept
  try { for (const r of (await cache?.keys()) ?? []) if (!keys.has(r.url)) await cache!.delete(r); } catch { /* next time */ }
  return out;
}

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 0;
const waiting = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>();

function call(msg: Record<string, unknown>, transfer: Transferable[]): Promise<any> {
  const w = worker;
  if (!w) return Promise.reject(new Error("Stopped"));
  const id = ++nextId;
  return new Promise((ok, no) => { waiting.set(id, { ok, no }); w.postMessage({ ...msg, id }, transfer); });
}

// Bumped by stopStt: a run that was loading the model or opening the recording when the editor closed or the journal
// locked sees it changed and stops there, before a worker starts or the recording is handed over.
let generation = 0;
const stopped = () => new Error("Stopped");

function start(onProgress: (p: SttProgress) => void): Promise<void> {
  const gen = generation;
  ready ??= (async () => {
    const files = await loadFiles(onProgress);
    if (gen !== generation) throw stopped();
    onProgress({ step: "Getting the speech model ready", progress: null });
    // never two: one left from before goes first
    worker?.terminate();
    const w = new Worker(new URL("./stt.worker.ts", import.meta.url), { type: "module" });
    worker = w;
    w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; text?: string; error?: string }>) => {
      const p = waiting.get(e.data.id);
      if (!p) return;
      waiting.delete(e.data.id);
      if (e.data.ok) p.ok(e.data.text); else p.no(new Error(e.data.error || "The speech model stopped"));
    };
    w.onerror = () => fail(new Error("The speech model couldn't start on this device."));
    // the engine's loader script comes from the app's own files (a worker resolves addresses against its own script)
    await call({ type: "load", files, glue: new URL(model!.glue, location.href).href }, Object.values(files));
  })().catch((e) => {
    // a stopped run's failure must not end a newer one
    if (gen === generation) stopStt();
    throw e;
  });
  return ready;
}

function fail(e: Error) { for (const w of waiting.values()) w.no(e); waiting.clear(); }

/** The recording as Whisper hears it: one channel at 16 kHz. */
async function decode(audio: Blob): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, 16000);
  let buf: AudioBuffer;
  try { buf = await ctx.decodeAudioData(await audio.arrayBuffer()); }
  catch { throw new Error("This device can't open the recording to transcribe it."); }
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const mixed = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mixed[i] = mixed[i]! + d[i]! / buf.numberOfChannels; }
  return mixed;
}

/** The words in a voice note. One at a time; the model is kept for the next one and let go by stopStt. */
export async function transcribe(audio: Blob, onProgress: (p: SttProgress) => void): Promise<string> {
  const gen = generation;
  await start(onProgress);
  if (gen !== generation) throw stopped();
  onProgress({ step: "Opening the recording", progress: null });
  const pcm = await decode(audio);
  if (gen !== generation) throw stopped();
  onProgress({ step: "Turning speech into text", progress: null });
  const text: string = (await call({ type: "run", audio: pcm }, [pcm.buffer])) ?? "";
  // Whisper marks silence and sounds in brackets ("[BLANK_AUDIO]", "(wind blowing)"): not words of the dream
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Lets the worker go (the editor closed, or the journal locked): it holds the recording and its words in memory. */
export function stopStt() {
  generation++;
  worker?.terminate();
  worker = null; ready = null;
  fail(new Error("Stopped"));
}
