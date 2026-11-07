// WCAG contrast of each colour set's text tokens on its surfaces (LDJ-44). Reads the sets from apps/web/src/core/theme.ts
// and the night tokens from styles/tokens.css, so it follows the code. `node scripts/contrast.mjs [Set|all]`.
// Body text needs 4.5:1; large text and UI parts (accent, the faint night hint) need 3:1.
import { readFileSync } from "node:fs";
const root = new URL("../apps/web/src/", import.meta.url);
const ts = readFileSync(new URL("core/theme.ts", root), "utf8"), css = readFileSync(new URL("styles/tokens.css", root), "utf8");
const ATM = {};
for (const m of ts.matchAll(/^\s+(\w+): \{ L: \[([^\]]+)\], D: \[([^\]]+)\] \},$/gm)) {
  const p = (s) => s.split(",").map((x) => x.trim().replace(/"/g, ""));
  ATM[m[1]] = { L: p(m[2]), D: p(m[3]) };
}
const xdef = /XDEF[^=]*= \{ L: \{ tx: "(#\w+)".*?D: \{ tx: "(#\w+)"/.exec(ts);
const tx2 = /d \? "(#\w+)" : "(#\w+)"/.exec(ts);
const tok = (n) => new RegExp("--" + n + ":\\s*(#\\w+)").exec(css)[1];
const rgb = (h) => { h = h.replace("#", ""); if (h.length === 3) h = [...h].map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const hex = (c) => "#" + c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
const mix = (a, p, b) => hex(rgb(a).map((x, i) => x * p + rgb(b)[i] * (1 - p))); // color-mix(in srgb, a p, b)
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export function pairs(name) {
  const out = [];
  for (const k of ["D", "L"]) {
    const a = ATM[name][k], d = k === "D", tx = d ? xdef[2] : xdef[1], t2 = d ? tx2[1] : tx2[2], bg = a[3];
    const s = { bg, s1: mix(tx, d ? 0.05 : 0.03, bg), s2: mix(tx, d ? 0.1 : 0.07, bg), glow: mix(a[0], 0.2, bg) };
    for (const [sn, sv] of Object.entries(s)) {
      out.push([k, "tx", sn, ratio(tx, sv), 4.5], [k, "tx2", sn, ratio(t2, sv), 4.5], [k, "acc", sn, ratio(a[0], sv), 4.5]);
    }
    out.push([k, "on", "acc", ratio(a[5], a[0]), 4.5], [k, "onc", "accc", ratio(a[2], a[1]), 4.5]);
  }
  for (const s of ["sdim", "sdim2"]) out.push(["-", "sdimtx", s, ratio(tok("sdimtx"), tok(s)), 4.5], ["-", "sdimtx2", s, ratio(tok("sdimtx2"), tok(s)), 3]);
  return out;
}

const arg = process.argv[2] ?? "Dusk", names = arg === "all" ? Object.keys(ATM) : [arg];
let bad = 0;
for (const n of names) {
  const rows = pairs(n), fail = rows.filter((r) => r[3] < r[4]);
  bad += fail.length;
  if (arg === "all") { console.log(n.padEnd(9), fail.length ? fail.map((r) => `${r[0]} ${r[1]}/${r[2]} ${r[3].toFixed(2)}`).join(", ") : "ok"); continue; }
  console.log("mode token   on      ratio  need");
  for (const r of rows) console.log(`${r[0]}    ${r[1].padEnd(8)} ${r[2].padEnd(6)} ${r[3].toFixed(2).padStart(6)}  ${r[4]}${r[3] < r[4] ? "  FAIL" : ""}`);
}
process.exitCode = bad ? 1 : 0;
