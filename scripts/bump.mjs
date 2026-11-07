// Starts a release (run by the developer only, when 0.1.0 or a later version is ready):
//   node scripts/bump.mjs 0.2.0
// Sets the version in every package.json (root, desktop, android, web) and turns the Unreleased section of CHANGELOG.md
// into "## [x.y.z] - date" with a fresh empty Unreleased above it. Pushing that heading to main publishes the release
// (.github/workflows/release.yml), so check the notes first. Nothing else in the repository ever adds such a heading.
import fs from "node:fs";
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? "")) { console.error("usage: node scripts/bump.mjs <x.y.z>"); process.exit(1); }
const root = new URL("../", import.meta.url);
const cf = new URL("CHANGELOG.md", root);
const c = fs.readFileSync(cf, "utf8");
if (new RegExp(`^## \\[${v.replace(/\./g, "\\.")}\\]`, "m").test(c)) { console.error(`CHANGELOG.md already has ${v}`); process.exit(1); }
const m = /^## Unreleased[ \t]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(c);
if (!m || !/[A-Za-z0-9]/.test(m[1])) { console.error("CHANGELOG.md has nothing under Unreleased: write the notes first"); process.exit(1); }
for (const p of ["package.json", "apps/desktop/package.json", "apps/android/package.json", "apps/web/package.json"]) {
  const f = new URL(p, root), j = JSON.parse(fs.readFileSync(f, "utf8"));
  // keep "version" next to "name" in files that had none
  const out = {};
  for (const [k, val] of Object.entries(j)) { if (k !== "version") out[k] = val; if (k === "name") out.version = v; }
  if (!("name" in j)) out.version = v;
  fs.writeFileSync(f, JSON.stringify(out, null, 2) + "\n");
}
fs.writeFileSync(cf, c.replace(/^## Unreleased[ \t]*$/m, `## Unreleased\n\n## [${v}] - ${new Date().toISOString().slice(0, 10)}`));
console.log(`Version ${v}: read CHANGELOG.md once more, then push to main to publish.`);
