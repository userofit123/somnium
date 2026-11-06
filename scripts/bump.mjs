// Starts a new version: sets it in package.json and adds a section at the top of CHANGELOG.md to fill in.
//   node scripts/bump.mjs 0.2.0
import fs from "node:fs";
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? "")) { console.error("usage: node scripts/bump.mjs <x.y.z>"); process.exit(1); }
const root = new URL("../", import.meta.url);
for (const p of ["package.json", "apps/desktop/package.json"]) {
  const f = new URL(p, root), j = JSON.parse(fs.readFileSync(f, "utf8"));
  j.version = v; fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
}
const cf = new URL("CHANGELOG.md", root);
const c = fs.readFileSync(cf, "utf8");
// the Unreleased section becomes this version's, and a fresh Unreleased goes above it (never a [x.y.z] heading before a release)
fs.writeFileSync(cf, c.replace(/^## Unreleased\s*$/m, `## Unreleased\n\n## [${v}] - ${new Date().toISOString().slice(0, 10)}`));
console.log(`Version ${v}: fill in CHANGELOG.md, then merge to main to publish.`);
