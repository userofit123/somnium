// Makes saved files show up inside the dev containers right away.
//
// Docker Desktop shares this folder with its VM over virtiofs. Most editors (and Claude Code) save a file
// by writing a new copy and renaming it over the old one. The VM keeps seeing the old copy until the new one
// is written to again, so hot reload never notices the change. This script checks the source folders a few
// times a second and, when a file has been replaced (its inode changed), rewrites its first byte in place
// (same content), which makes the VM pick up the new file.
// It polls instead of using fs.watch because Node's recursive watcher loses a file once it has been replaced.
//
//   node scripts/dev-nudge.mjs          (runs until stopped; installed as a user service by scripts/dev-setup.sh)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIRS = ["apps", "packages", "scripts"];
// only source folders are watched: photos, builds and installed packages never need a nudge
const SKIP = new Set(["node_modules", ".pnpm-store", ".git", "dist", "build", "coverage", ".gradle", "images", "public", "android", "release", "data"]);
const EVERY_MS = 500;
const inodes = new Map(); // file → inode last seen

function nudge(file) {
  try {
    const fd = fs.openSync(file, "r+");
    try {
      const b = Buffer.alloc(1);
      if (fs.readSync(fd, b, 0, 1, 0) === 1) fs.writeSync(fd, b, 0, 1, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // removed or busy: the next pass tries again if it is still new
  }
}

function walk(dir, first) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, first); continue; }
    if (!e.isFile()) continue;
    let ino;
    try { ino = fs.statSync(p).ino; } catch { continue; }
    const seen = inodes.get(p);
    inodes.set(p, ino);
    if (!first && seen !== ino) nudge(p); // replaced, or a new file
  }
}

const pass = (first = false) => { for (const d of DIRS) walk(path.join(ROOT, d), first); };
pass(true);
setInterval(pass, EVERY_MS);
console.log(`dev-nudge: watching ${DIRS.join(", ")} in ${ROOT}`);
