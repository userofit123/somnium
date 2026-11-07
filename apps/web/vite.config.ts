import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
    "connect-src 'self' ws: wss:",
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
  plugins: [vue(), swBuildId(), ocrModel()],
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
