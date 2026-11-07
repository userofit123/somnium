// Copies the built web app into www/ for the Android app, and puts the Content-Security-Policy into its index.html as
// a <meta> tag: the app's files come from the bundle (Capacitor's https://localhost), not from a server that could
// send the header. The same policy as the server's (apps/server/src/headers.ts), with these differences:
// - connect-src also allows https: and http:, because the person's own server can be at any address they choose
//   (most requests go through CapacitorHttp, the native side, which the policy doesn't see; this is for the rest),
//   and api.github.com for the update check a local account makes itself (src/core/releases.ts);
// - no frame-ancestors: a <meta> policy can't carry it (the app is not framed by anything anyway).
// The hashes are taken from the built index.html here, never typed in, so they can't drift.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../..");
fs.rmSync("www", { recursive: true, force: true });
// Only what the app runs: no source maps (they would ship the source and are of no use on a phone), no dotfiles or
// editor and OS leftovers, and not the web app's service worker (main.ts never registers it inside the app, which
// carries its own files). The manifest stays: index.html links it.
const dist = path.join(root, "apps/web/dist");
if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error("apps/web/dist has no index.html: build the web app first");
const skip = (name) => name.startsWith(".") || /\.map$/i.test(name) || /~$/.test(name) || /^(sw\.js|thumbs\.db|stats\.html)$/i.test(name);
fs.cpSync(dist, "www", { recursive: true, filter: (src) => src === dist || !skip(path.basename(src)) });

const file = path.join("www", "index.html");
const html = fs.readFileSync(file, "utf8");
const hash = (body) => `'sha256-${crypto.createHash("sha256").update(body, "utf8").digest("base64")}'`;
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc\s*=/i.test(m[1])).map((m) => hash(m[2]));
const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => hash(m[1]));
const csp = [
  "default-src 'self'",
  ["script-src 'self' 'wasm-unsafe-eval'", ...scripts].join(" "),
  ["style-src 'self'", ...styles].join(" "),
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' https: http:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
// first thing in <head>, before the inline script it covers
if (!/<head>/i.test(html)) throw new Error("index.html has no <head>");
fs.writeFileSync(file, html.replace(/<head>/i, `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`));
// and a sourceMappingURL left in a bundle would point at a file that isn't there: drop the comment
for (const f of fs.readdirSync("www", { recursive: true })) {
  const p = path.join("www", String(f));
  if (!/\.(js|css)$/.test(p) || !fs.statSync(p).isFile()) continue;
  const t = fs.readFileSync(p, "utf8");
  const u = t.replace(/\n?\/[/*][#@] sourceMappingURL=\S+?(\s*\*\/)?\s*$/, "");
  if (u !== t) fs.writeFileSync(p, u);
}
console.log("www ready (with its Content-Security-Policy)");
