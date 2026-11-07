import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

// In Docker the page is opened through a proxy: Caddy at https://somnium.local, or Tailscale at
// https://<machine>.ts.net:8444 from a phone. Hot reload then connects back to whatever address and port
// the page came from (VITE_HMR_HOST is set in docker-compose.dev.yml).
const hmrHost = process.env.VITE_HMR_HOST;

export default defineConfig({
  plugins: [vue(), swBuildId()],
  // PGlite (the database for local accounts in the Android app) ships its own WebAssembly files
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  define: { "import.meta.env.VITE_VERSION": JSON.stringify(process.env.SOMNIUM_VERSION ?? "") },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: ["somnium.local", "localhost", ".ts.net"],
    // Polling notices edits that replace the file (editors, sed -i), which file events in a container can miss.
    watch: process.env.WATCH_POLL ? { usePolling: true, interval: 300 } : undefined,
    hmr: hmrHost ? { protocol: "wss" } : undefined,
    proxy: { "/api": process.env.API_URL ?? "http://localhost:8080" },
  },
});
