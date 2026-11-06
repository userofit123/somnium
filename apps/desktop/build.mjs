// Bundles the main process (with the embedded Somnium server) and the preload script.
import { build } from "esbuild";
const common = { bundle: true, platform: "node", target: "node20", format: "cjs", sourcemap: false, logLevel: "info" };
await build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs", external: ["electron", "electron-updater", "pg-native", "@electric-sql/pglite"],
  loader: { ".json": "json" }, define: { "import.meta.dirname": "__dirname" } });
await build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs", external: ["electron"] });
import fs from "node:fs";
fs.copyFileSync("src/accounts.html", "dist/accounts.html");
fs.copyFileSync("assets/icon.png", "dist/icon.png");
