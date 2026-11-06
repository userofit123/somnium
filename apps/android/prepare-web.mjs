// Copies the built web app into www/ for the Android app.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
fs.rmSync("www", { recursive: true, force: true });
fs.cpSync(path.join(root, "apps/web/dist"), "www", { recursive: true });
console.log("www ready");
