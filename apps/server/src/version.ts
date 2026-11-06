// The running version (from the root package.json, set by scripts/bump.mjs) and the check for a newer release on GitHub.
import fs from "node:fs";
import path from "node:path";
import { newer } from "@somnium/shared";

function readVersion(): string {
  try { const v = fs.readFileSync(path.resolve(process.cwd(), "VERSION"), "utf8").trim(); if (v) return v; } catch { /* not in the image */ }
  for (const p of [path.resolve(import.meta.dirname, "../../../package.json"), path.resolve(process.cwd(), "package.json")]) {
    try { const v = JSON.parse(fs.readFileSync(p, "utf8")).version; if (v) return v; } catch { /* try the next */ }
  }
  return process.env.SOMNIUM_VERSION ?? "0.0.0";
}
export const VERSION = process.env.SOMNIUM_VERSION ?? readVersion();
/** Raised when the API changes in a way older apps cannot follow; apps compare it with the level they were built for. */
export const API_LEVEL = 1;
export const REPO = process.env.SOMNIUM_REPO ?? "userofit123/somnium";

type GhAsset = { name: string; browser_download_url: string; size?: number };
let cache: { at: number; value: unknown } | null = null;
/** The latest GitHub release, cached for an hour (GitHub allows 60 unauthenticated requests an hour per address). */
export async function checkForUpdate() {
  if (cache && cache.at > Date.now() - 3600000) return cache.value;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "somnium" } });
    // 404: no release published yet (or the repository is still private); not a failure to report as one
    if (r.status === 404) {
      const value = { current: VERSION, latest: null, newer: false, assets: [], error: "No releases found" };
      cache = { at: Date.now(), value };
      return value;
    }
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { tag_name?: string; body?: string; html_url?: string; published_at?: string; assets?: GhAsset[] };
    const latest = String(j.tag_name ?? "").replace(/^v/, "");
    const assets = (j.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
    const value = { current: VERSION, latest, newer: newer(latest, VERSION), notes: j.body ?? "", url: j.html_url, publishedAt: j.published_at, assets };
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    return { current: VERSION, latest: null, newer: false, error: "Could not reach GitHub" };
  }
}
