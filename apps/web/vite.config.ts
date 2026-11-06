import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// In Docker the page is opened through a proxy: Caddy at https://somnium.local, or Tailscale at
// https://<machine>.ts.net:8444 from a phone. Hot reload then connects back to whatever address and port
// the page came from (VITE_HMR_HOST is set in docker-compose.dev.yml).
const hmrHost = process.env.VITE_HMR_HOST;

export default defineConfig({
  plugins: [vue()],
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
