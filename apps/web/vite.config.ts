import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// The service worker's cache is named after the build (public/sw.js BUILD): the id is made from the built files'
// names, which carry their content's hash, so it changes exactly when the app does. Written into the copied sw.js
// once everything is on disk.
function swBuildId(): Plugin {
  let outDir = "dist", id = "";
  return {
    name: "somnium-sw-build-id",
    apply: "build",
    configResolved(c) { outDir = c.build.outDir; },
    generateBundle(_o, bundle) { id = createHash("sha256").update(Object.keys(bundle).sort().join("\n")).digest("hex").slice(0, 12); },
    closeBundle() {
      const f = join(outDir, "sw.js");
      if (!id || !existsSync(f)) return;
      const src = readFileSync(f, "utf8");
      if (!src.includes("__SOMNIUM_BUILD__")) throw new Error("sw.js has no build id mark");
      writeFileSync(f, src.replace(/__SOMNIUM_BUILD__/g, id));
    },
  };
}

// The English model for reading photos (src/core/ocr.ts). Tesseract fetches a model as <dir>/eng.traineddata.gz, so the
// file keeps that name and the content hash goes in its folder: assets/ocr-eng-<hash>/eng.traineddata.gz (a new
// model is a new address, like every built file). `virtual:ocr-eng` is its address. tessdata: Apache License 2.0.
function ocrModel(): Plugin {
  const VID = "virtual:ocr-eng", RID = "\0" + VID;
  const file = join(dirname(fileURLToPath(import.meta.url)), "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz");
  let build = false;
  return {
    name: "somnium-ocr-model",
    configResolved(c) { build = c.command === "build"; },
    resolveId(id) { return id === VID ? RID : null; },
    load(id) {
      if (id !== RID) return null;
      if (!build) return `export default ${JSON.stringify("/@fs" + file)};`;
      const src = readFileSync(file);
      const name = `assets/ocr-eng-${createHash("sha256").update(src).digest("hex").slice(0, 10)}/eng.traineddata.gz`;
      this.emitFile({ type: "asset", fileName: name, source: src });
      return `export default import.meta.env.BASE_URL + ${JSON.stringify(name)};`;
    },
  };
}

// The speech model for "Transcribe voice notes" (src/core/transcribe.ts, LDJ-176): Whisper tiny.en, fetched at build time by
// scripts/fetch-speech-model.mjs into stt-model/ (it writes manifest.json once every file is there and checked), and the
// speech engine's WebAssembly (onnxruntime-web, single-threaded). All go to assets/stt-model-<hash>/, one folder whose
// name changes with its content. The engine's small loader script (20 kB) goes with the app's own files instead
// (assets/stt-ort-<hash>.js): a script can only be loaded from the app itself, never from the server's address. The desktop and Android builds leave that folder out (apps/desktop/package.json,
// apps/android/prepare-web.mjs): their copies of the app load it from the person's server. `virtual:stt-model` is
// null when the model wasn't fetched: the build goes on and the feature isn't offered.
function sttModel(): Plugin {
  const VID = "virtual:stt-model", RID = "\0" + VID;
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "stt-model");
  // the engine's own file, next to the package Transformers.js depends on (pnpm keeps it out of apps/web/node_modules)
  const ort = dirname(createRequire(realpathSync(join(here, "node_modules/@huggingface/transformers/package.json"))).resolve("onnxruntime-web/wasm"));
  const wasm = join(ort, "ort-wasm-simd-threaded.wasm"), glue = join(ort, "ort-wasm-simd-threaded.mjs");
  let build = false;
  const read = () => {
    try {
      const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { files: Record<string, string> };
      return Object.keys(m.files).every((f) => existsSync(join(dir, f))) && existsSync(wasm) ? m.files : null;
    } catch { return null; }
  };
  return {
    name: "somnium-stt-model",
    configResolved(c) { build = c.command === "build"; },
    resolveId(id) { return id === VID ? RID : null; },
    load(id) {
      if (id !== RID) return null;
      const files = read();
      if (!files) { if (build) this.warn("no speech model in apps/web/stt-model (scripts/fetch-speech-model.mjs): built without it"); return "export default null;"; }
      const wasmHash = createHash("sha256").update(readFileSync(wasm)).digest("hex");
      const all: Record<string, string> = { ...files, "ort-wasm-simd-threaded.wasm": wasmHash };
      const sizes = Object.fromEntries(Object.keys(all).map((f) => [f, readFileSync(f.endsWith(".wasm") ? wasm : join(dir, f)).length]));
      if (!build) return `export default ${JSON.stringify({ dir: "/@fs" + dir + "/", wasmDir: "/@fs" + ort + "/", glue: "/@fs" + glue, files: all, sizes })};`;
      const glueSrc = readFileSync(glue);
      const glueName = `assets/stt-ort-${createHash("sha256").update(glueSrc).digest("hex").slice(0, 10)}.js`;
      this.emitFile({ type: "asset", fileName: glueName, source: glueSrc });
      const folder = `assets/stt-model-${createHash("sha256").update(JSON.stringify(all)).digest("hex").slice(0, 10)}/`;
      for (const f of Object.keys(all)) this.emitFile({ type: "asset", fileName: folder + f, source: readFileSync(f.endsWith(".wasm") ? wasm : join(dir, f)) });
      return `export default { dir: import.meta.env.BASE_URL + ${JSON.stringify(folder)}, wasmDir: null, glue: import.meta.env.BASE_URL + ${JSON.stringify(glueName)}, files: ${JSON.stringify(all)}, sizes: ${JSON.stringify(sizes)} };`;
    },
  };
}

// In Docker the page is opened through a proxy: Caddy at https://somnium.local, or Tailscale at
// https://<machine>.ts.net:8444 from a phone. Hot reload then connects back to whatever address and port
// the page came from (VITE_HMR_HOST is set in docker-compose.dev.yml).
const hmrHost = process.env.VITE_HMR_HOST;

// The dev server's own security headers: close to the built app's (apps/server/src/headers.ts) but looser where hot
// reload needs it - inline scripts and styles (Vite injects them), and websockets back to the dev server. The strict
// policy is the server's, on the built app.
const devHeaders = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self' ws: wss: https://api.github.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "),
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), display-capture=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=()",
  "cross-origin-opener-policy": "same-origin",
  "x-content-type-options": "nosniff",
};

export default defineConfig({
  plugins: [vue(), swBuildId(), ocrModel(), sttModel()],
  // Transformers.js runs on the plain WebAssembly build of its engine (no WebGPU part, half the size): core/stt.worker.ts
  resolve: { alias: [{ find: /^onnxruntime-web$/, replacement: "onnxruntime-web/wasm" }] },
  // the speech worker loads Transformers.js only when it starts, which needs module workers
  // (its files are named stt-*, so the service worker doesn't fetch them ahead for everyone: public/sw.js HEAVY)
  worker: { format: "es", rollupOptions: { output: { entryFileNames: "assets/stt-[name]-[hash].js", chunkFileNames: "assets/stt-[name]-[hash].js" } } },
  // PGlite (the database for local accounts in the Android app) ships its own WebAssembly files
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  define: { "import.meta.env.VITE_VERSION": JSON.stringify(process.env.SOMNIUM_VERSION ?? "") },
  // the photo text reader's files (src/core/ocr.ts) are named ocr-*, so the service worker can tell them apart: it keeps
  // them once used and doesn't fetch megabytes ahead for people who never switch Photos and OCR on (public/sw.js HEAVY)
  build: {
    rollupOptions: {
      output: {
        assetFileNames: (a) => (/worker\.min|tesseract-core/.test(a.names?.[0] ?? a.name ?? "") ? "assets/ocr-[name]-[hash][extname]" : "assets/[name]-[hash][extname]"),
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    headers: devHeaders,
    allowedHosts: ["somnium.local", "localhost", ".ts.net"],
    // Polling notices edits that replace the file (editors, sed -i), which file events in a container can miss.
    watch: process.env.WATCH_POLL ? { usePolling: true, interval: 300 } : undefined,
    hmr: hmrHost ? { protocol: "wss" } : undefined,
    proxy: { "/api": process.env.API_URL ?? "http://localhost:8080" },
  },
});
