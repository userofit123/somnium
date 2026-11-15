// Renders every app icon from the two masters: apps/web/public/icon.svg (the full-colour quill on the plum squircle)
// and scripts/icon-glyph.svg (the one-colour quill used where an icon is drawn small or tinted).
// Run on the host, not in the pnpm container, since it drives the Playwright Chromium (`npx playwright install
// chromium` once): Chromium renders the master's lighting and shadow filters faithfully, where librsvg and resvg do not.
//   node scripts/icons.mjs              writes the web, Android and desktop icons
//   node scripts/icons.mjs <dir>        also writes previews (masks over the maskable and adaptive icons) into <dir>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpmDir = path.join(root, "node_modules/.pnpm");
const pw = fs.readdirSync(pnpmDir).find((d) => /^playwright@\d/.test(d));
if (!pw) throw new Error("Playwright is not installed: run pnpm install first");
const { chromium } = createRequire(import.meta.url)(path.join(pnpmDir, pw, "node_modules/playwright"));

const master = fs.readFileSync(path.join(root, "apps/web/public/icon.svg"), "utf8");
const glyph = fs.readFileSync(path.join(root, "scripts/icon-glyph.svg"), "utf8");
const defs = master.match(/<defs>([\s\S]*)<\/defs>/)[1];
// the artwork without its squircle: the quill, its shadow and glow, and the ink
const body = master.match(/<g clip-path="url\(#sq\)">([\s\S]*)<\/g><rect x="1\.5"/)[1];
const bgFull = '<rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#bgHi)"/><rect width="512" height="512" fill="url(#bgVig)"/>';
// The artwork's extent, measured from a render of `body` alone (glow excluded): it fits a circle of radius ART_R
// around (ART_X, ART_Y). Scaling by r / ART_R about that centre puts the whole quill and ink inside a circle of radius r.
const ART_X = 288, ART_Y = 260, ART_R = 205;
const fit = (r) => { const k = r / ART_R; return `translate(${256 - ART_X * k} ${256 - ART_Y * k}) scale(${k})`; };
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${defs}</defs>${inner}</svg>`;

// Below 64 px the ink's loop turns to noise: the small icon swaps it for one plain, thicker stroke of ink
const SMALL_INK = "M172.5 404.5C175.2 404.9 173.0 407.7 173.6 409.2C174.1 410.7 174.9 412.2 175.9 413.5C176.9 414.9 178.1 416.2 179.5 417.5C180.9 418.7 182.5 419.9 184.1 421.0C185.7 422.0 187.5 423.0 189.3 423.9C191.2 424.8 193.1 425.6 195.1 426.3C197.0 427.0 199.1 427.7 201.1 428.3C203.2 428.9 205.3 429.4 207.4 429.9C209.5 430.3 211.7 430.7 213.8 431.1C216.0 431.5 218.2 431.8 220.3 432.0C222.5 432.3 224.7 432.5 226.9 432.7C229.2 432.9 231.4 433.0 233.6 433.1C235.8 433.2 238.1 433.3 240.3 433.3C242.5 433.4 244.8 433.4 247.0 433.4C249.3 433.3 251.5 433.3 253.8 433.2C256.0 433.1 258.3 433.0 260.5 432.9C262.7 432.8 265.0 432.6 267.2 432.4C269.5 432.2 271.7 432.0 274.0 431.8C276.3 431.6 278.5 431.4 280.8 431.1C283.0 430.9 285.3 430.6 287.5 430.3C289.8 430.0 292.0 429.7 294.3 429.4C296.5 429.0 298.8 428.7 301.0 428.4C303.3 428.0 305.5 427.6 307.8 427.3C310.0 427.0 313.3 426.2 314.6 426.4C315.8 426.7 316.1 428.0 315.1 428.8C314.1 429.5 310.8 430.3 308.6 431.0C306.4 431.7 304.2 432.3 302.0 433.0C299.8 433.6 297.5 434.1 295.3 434.7C293.1 435.3 290.8 435.8 288.6 436.3C286.3 436.8 284.1 437.3 281.8 437.8C279.6 438.2 277.3 438.7 275.0 439.1C272.8 439.5 270.5 439.9 268.2 440.3C265.9 440.6 263.6 441.0 261.3 441.3C259.0 441.6 256.7 441.9 254.4 442.1C252.1 442.4 249.8 442.6 247.5 442.8C245.1 443.0 242.8 443.1 240.5 443.3C238.2 443.4 235.8 443.5 233.5 443.5C231.1 443.6 228.8 443.6 226.4 443.6C224.1 443.5 221.7 443.4 219.4 443.3C217.0 443.2 214.7 443.0 212.3 442.8C209.9 442.5 207.5 442.2 205.2 441.9C202.8 441.5 200.4 441.1 198.0 440.5C195.7 440.0 193.3 439.4 191.0 438.7C188.6 438.0 186.2 437.2 183.9 436.2C181.6 435.2 179.2 434.1 177.0 432.8C174.7 431.5 172.5 430.1 170.4 428.4C168.3 426.7 166.2 424.8 164.4 422.6C162.6 420.4 161.0 417.8 159.8 415.1C158.6 412.5 155.1 408.5 157.2 406.8C159.3 405.0 169.7 404.0 172.5 404.5Z";
const smallInk = (s) => {
  const out = s.replace(/<path d="[^"]*" fill="url\(#fInk\)" opacity="\.9"\/>/, `<path d="${SMALL_INK}" fill="url(#fInk)"/>`);
  if (out === s) throw new Error("the ink path in icon.svg was not found");
  return out;
};

const art = {
  // full icon as drawn: the squircle with its rim light
  full: master,
  small: smallInk(master),
  // maskable (PWA): full-bleed plum, the art inside the inner 80% safe circle (radius 0.4 of the side), a little margin
  maskable: svg(bgFull + `<g transform="${fit(0.37 * 512)}">${body}</g>`),
  // Android adaptive layers (108dp canvas, 66dp safe circle: radius 0.3056 of the side)
  background: svg(bgFull),
  foreground: svg(`<g transform="${fit(0.29 * 512)}">${body}</g>`),
  // legacy round launcher (Android 7.1): the plum disc
  round: svg(`<clipPath id="disc"><circle cx="256" cy="256" r="256"/></clipPath><g clip-path="url(#disc)">${bgFull}<g transform="${fit(0.36 * 512)}">${body}</g></g>`),
};

art.roundSmall = smallInk(art.round);

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1024, height: 1024 } });
async function png(svgText, size, out, bg = null) {
  const s = svgText.replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg ?? "transparent"}">${s}</body></html>`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: !bg, clip: { x: 0, y: 0, width: size, height: size } });
}
const at = (p) => path.join(root, p);

// web / PWA
for (const n of [192, 512, 1024]) await png(art.full, n, at(`apps/web/public/icon-${n}.png`));
// browser tabs draw the favicon at 16 to 32 px
fs.writeFileSync(at("apps/web/public/favicon.svg"), art.small);
for (const n of [192, 512]) await png(art.maskable, n, at(`apps/web/public/icon-maskable-${n}.png`));
// desktop: electron-builder makes the Linux sizes and the Windows .ico from this; the app also uses it for the window,
// notifications and the tray (resized there)
await png(art.full, 1024, at("apps/desktop/assets/icon.png"));
await png(art.small, 64, at("apps/desktop/assets/tray.png"));

// Android launcher icons: 48dp legacy, 108dp adaptive layers
const res = "apps/android/android/app/src/main/res";
for (const [d, k] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  await png(k < 1.5 ? art.small : art.full, 48 * k, at(`${res}/mipmap-${d}/ic_launcher.png`));
  await png(k < 1.5 ? art.roundSmall : art.round, 48 * k, at(`${res}/mipmap-${d}/ic_launcher_round.png`));
  await png(art.foreground, 108 * k, at(`${res}/mipmap-${d}/ic_launcher_foreground.png`));
  await png(art.background, 108 * k, at(`${res}/mipmap-${d}/ic_launcher_background.png`));
}
// Android splash (before Android 12): the icon at 30% of the short side, centred on the app's night background
const night = "#141233";
const splash = { "": [480, 320], "land-mdpi": [480, 320], "land-hdpi": [800, 480], "land-xhdpi": [1280, 720], "land-xxhdpi": [1600, 960], "land-xxxhdpi": [1920, 1280], "port-mdpi": [320, 480], "port-hdpi": [480, 800], "port-xhdpi": [720, 1280], "port-xxhdpi": [960, 1600], "port-xxxhdpi": [1280, 1920] };
for (const [q, [w, h]] of Object.entries(splash)) {
  const n = Math.round(Math.min(w, h) * 0.3);
  const inner = master.replace("<svg ", `<svg width="${n}" height="${n}" `);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:${night};display:grid;place-items:center;height:100vh">${inner}</body></html>`);
  await page.screenshot({ path: at(`${res}/drawable${q ? "-" + q : ""}/splash.png`), clip: { x: 0, y: 0, width: w, height: h } });
}

// previews: the full icon at 512 and 48, the glyph small, the maskable and adaptive icons under their masks
const dir = process.argv[2];
if (dir) {
  fs.mkdirSync(dir, { recursive: true });
  await png(art.full, 512, path.join(dir, "full-512.png"));
  await png(art.full, 48, path.join(dir, "full-48.png"));
  await png(art.small, 48, path.join(dir, "small-48.png"));
  await png(art.small, 24, path.join(dir, "small-24.png"));
  await png(art.small, 16, path.join(dir, "small-16.png"));
  const g = (c) => glyph.replace(/currentColor/g, c);
  await png(g("#ffffff"), 24, path.join(dir, "glyph-24-white.png"), "#30124c");
  await png(g("#ffffff"), 96, path.join(dir, "glyph-96-white.png"), "#30124c");
  const ring = (shape) => `<g fill="none" stroke="#ff3b6b" stroke-width="3">${shape}</g>`;
  const dim = (clip) => `<defs><mask id="m"><rect width="512" height="512" fill="#fff"/>${clip.replace(/<(\w+)/, '<$1 fill="#000"')}</mask></defs><rect width="512" height="512" fill="#000" opacity=".6" mask="url(#m)"/>`;
  const over = (base, shape) => base.replace(/<\/svg>$/, dim(shape) + ring(shape) + "</svg>");
  await png(over(art.maskable, '<circle cx="256" cy="256" r="204.8"/>'), 512, path.join(dir, "maskable-512-circle.png"));
  const adaptive = svg(bgFull + `<g transform="${fit(0.29 * 512)}">${body}</g>`);
  // launcher masks are drawn on the 72dp visible part of the 108dp canvas; the safe circle is 66dp
  const vis = 512 * 72 / 108, o = (512 - vis) / 2;
  await png(over(adaptive, `<circle cx="256" cy="256" r="${vis / 2}"/>`), 512, path.join(dir, "adaptive-circle.png"));
  await png(over(adaptive, `<rect x="${o}" y="${o}" width="${vis}" height="${vis}" rx="${vis * 0.3}"/>`), 512, path.join(dir, "adaptive-squircle.png"));
  await png(over(adaptive, `<circle cx="256" cy="256" r="${512 * 33 / 108}"/>`), 512, path.join(dir, "adaptive-safe-zone.png"));
  await png(art.round, 192, path.join(dir, "round-192.png"));
  await png(art.foreground, 512, path.join(dir, "foreground-only.png"), "#888888");
}
await b.close();
console.log("icons written");
