// The security headers on every answer the server gives (LDJ-59, PLAN.md §4.2 "strict CSP"), also used by the desktop
// app's own proxy (apps/desktop/src/main.ts). The Android app gets the same policy as a <meta> tag
// (apps/android/prepare-web.mjs) and the Vite dev server a looser one that lets hot reload work (apps/web/vite.config.ts).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The sha256 sources for the inline <script> and <style> blocks of a built index.html (the pre-paint script, the
 *  splash style). Taken from the file itself, never typed in, so they cannot drift from what the browser hashes. */
export function inlineHashes(html: string): { scripts: string[]; styles: string[] } {
  const hash = (body: string) => `'sha256-${crypto.createHash("sha256").update(body, "utf8").digest("base64")}'`;
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc\s*=/i.test(m[1]!)).map((m) => hash(m[2]!));
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => hash(m[1]!));
  return { scripts, styles };
}

/**
 * The Content-Security-Policy for the built app.
 * - 'wasm-unsafe-eval': the device database (PGlite) and the photo text reader (tesseract.js) are WebAssembly; it allows
 *   compiling WebAssembly and nothing else (no eval, no new Function).
 * - style-src-attr 'unsafe-inline': Vue writes style="" attributes (static template styles it turns into HTML, the
 *   splash); <style> elements and style sheets still have to come from the app itself or match a hash.
 * - worker-src blob:: what tesseract.js may fall back to for its worker; ours is loaded from the app (ocr.ts).
 * - connect-src: only the app's own server. The update check goes through the server (/api/update-check), so the
 *   browser never talks to GitHub; the Android app's policy adds what it needs (prepare-web.mjs).
 */
export function cspFor(html: string | null): string {
  const { scripts, styles } = html ? inlineHashes(html) : { scripts: [], styles: [] };
  return [
    "default-src 'self'",
    ["script-src 'self' 'wasm-unsafe-eval'", ...scripts].join(" "),
    ["style-src 'self'", ...styles].join(" "),
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

// What the app uses: the camera (photos of a page) and the microphone (voice notes), from its own pages only.
export const PERMISSIONS_POLICY = "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), display-capture=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=()";

/** The headers for every answer. The policy follows index.html: a rebuild while the server runs changes the hashes,
 *  so the file is looked at again when it changed (by time and size), not read once at start. The look is cheap and
 *  rare: at most once a second, not on every answer. It never throws (it runs inside onSend, where a throw would turn
 *  the answer into a 500): a file that is missing or half-written during a rebuild keeps the last good policy, and a
 *  read is only taken when the file did not change while it was being read. */
export function securityHeaders(webDir?: string, recheckMs = 1000): () => Record<string, string> {
  const file = webDir ? path.join(webDir, "index.html") : null;
  let seen = "", checkedAt = -Infinity;
  let headers = build(cspFor(null));
  const stamp = (st: fs.Stats) => `${st.mtimeMs}:${st.size}`;
  return () => {
    const now = Date.now();
    if (file && now - checkedAt >= recheckMs) {
      checkedAt = now;
      try {
        const before = stamp(fs.statSync(file));
        if (before !== seen) {
          const html = fs.readFileSync(file, "utf8");
          if (stamp(fs.statSync(file)) === before) { headers = build(cspFor(html)); seen = before; } // else mid-write: next time
        }
      } catch { /* no build yet, or a rebuild is replacing it: keep the last good set */ }
    }
    return headers;
  };
}
function build(csp: string): Record<string, string> {
  return {
    "content-security-policy": csp,
    "referrer-policy": "no-referrer",
    "permissions-policy": PERMISSIONS_POLICY,
    "cross-origin-opener-policy": "same-origin",
    // a browser must take every answer as the type it says it is: an uploaded file can never be run as a page or script
    "x-content-type-options": "nosniff",
  };
}
