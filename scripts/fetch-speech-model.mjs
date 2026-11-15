// Fetches the speech model for "Transcribe voice notes" (LDJ-176) at build time: Whisper tiny.en, quantized, in the
// ONNX form Transformers.js runs (Xenova/whisper-tiny.en, MIT licence). Every file comes from one fixed revision and is
// checked against its SHA-256 below, so a build gets exactly these bytes or none. They go to apps/web/stt-model
// (git-ignored) with a manifest.json; vite.config.ts sttModel() puts them in the built app as assets/stt-model-<hash>/,
// served by the person's own server. The running app never contacts Hugging Face.
// Never fails the build: when the files can't be fetched (no connection, Hugging Face down) it says so, leaves no
// half-written file and exits 0, and the build goes on without the model (the feature is then not offered).
//   node scripts/fetch-speech-model.mjs [--cache <dir>]
// --cache: keep the downloads there too (CI's and Docker's build caches), and take them from there next time.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Xenova/whisper-tiny.en";
const REVISION = "79fb389fc764e7c395bd330e9531d9d32ada7049";
const FILES = {
  "config.json": "37a1073be00d19118c06557896c7c148598f4d8277edc0f5bc07c9f5554839f1",
  "generation_config.json": "132c95ba9db45f4498f2eab3fea7c1d6a174005010f8f6b7d20cfd5e9795996b",
  "preprocessor_config.json": "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d",
  "tokenizer.json": "c6ee8f089220a5b1188f6426456772572671c6141ae007eecb83c6a8349f5deb",
  "tokenizer_config.json": "e082c1ad251541bf277967a703252cddd4bb37a71a43737e03d050c22ec08238",
  "onnx/encoder_model_quantized.onnx": "8cc3c6f8563d1b3fbd2c5af9f64c2bed8b020bc593c402d1ef53b9f08fbf1b90",
  "onnx/decoder_model_merged_quantized.onnx": "dbb2e063b7fbc41d9803b9698f93ecb035c50cbb3fb87b56cb131e4a5eb99059",
};

// set inside the try: even working out the paths must not fail the build (import.meta.dirname is missing before Node 20.11)
let out = null;
let cache = null;
const sha = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const good = (f, want) => { try { return fs.statSync(f).isFile() && sha(f) === want; } catch { return false; } };
const put = (dest, bytes) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest + ".part", bytes); fs.renameSync(dest + ".part", dest); };

async function fetchOne(name, want) {
  const dest = path.join(out, name);
  if (good(dest, want)) return "kept";
  if (cache && good(path.join(cache, name), want)) { put(dest, fs.readFileSync(path.join(cache, name))); return "from cache"; }
  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${name}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== want) throw new Error(`${name}: checksum mismatch (got ${got})`);
  put(dest, bytes);
  if (cache) put(path.join(cache, name), bytes);
  return "fetched";
}

try {
  out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/web/stt-model");
  const ci = process.argv.indexOf("--cache");
  cache = ci > 0 && process.argv[ci + 1] ? path.resolve(process.argv[ci + 1]) : null;
  for (const [name, want] of Object.entries(FILES)) console.log(`speech model: ${name} ${await fetchOne(name, want)}`);
  // last, once every file is there and checked: the build reads it (apps/web/vite.config.ts sttModel)
  put(path.join(out, "manifest.json"), JSON.stringify({ repo: REPO, revision: REVISION, files: FILES }, null, 2) + "\n");
  console.log(`speech model ready in ${path.relative(process.cwd(), out) || out}`);
} catch (e) {
  // nothing half-there: vite.config.ts offers the feature only when every file is present
  try { if (out) fs.rmSync(out, { recursive: true, force: true }); } catch { /* nothing to clear */ }
  console.warn(`speech model not fetched (${e instanceof Error ? e.message : e}); building without "Transcribe voice notes"`);
}
