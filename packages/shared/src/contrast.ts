// The colour sets and the WCAG contrast maths, kept pure (no Vue) so a test can check every set (LDJ-44, LDJ-60).
// The web app's core/theme.ts imports the data from here. Index of a set's six colours: accent, accent container,
// on-container, background, second accent, text on accent. Light-mode accents are kept dark enough for 4.5:1 text.
export type Pal = { L: string[]; D: string[] };
// Default text and secondary text per mode (theme.ts uses them when a set does not override them).
export const XDEF_TX = { L: "#1b1b22", D: "#e6e4ea" };
export const TX2 = { L: "#5a5865", D: "#a9a7b3" };
export const ATM: Record<string, Pal> = {
  Dusk: { L: ["#5142d4", "#e4dfff", "#1a1550", "#f8f7fd", "#1f8fb3", "#ffffff"], D: ["#a99cff", "#3d3490", "#e4dfff", "#141233", "#6fd6ff", "#1a1550"] },
  Ember: { L: ["#954523", "#ffe2d6", "#471500", "#fdf9f7", "#a52746", "#ffffff"], D: ["#f8b396", "#6f3820", "#fedccd", "#17100d", "#f47b99", "#441704"] },
  Indigo: { L: ["#4355b9", "#dee0ff", "#0b1550", "#fbf8fd", "#7b4fb8", "#fff"], D: ["#b9c3ff", "#2d3f9e", "#dee0ff", "#111218", "#c7a6ff", "#0b1550"] },
  Ocean: { L: ["#006778", "#b3ebff", "#001f26", "#f4fafc", "#2d7dd2", "#fff"], D: ["#4fd8eb", "#004e5c", "#b3ebff", "#0a1417", "#5aa9ff", "#00363f"] },
  Forest: { L: ["#2e6b3a", "#b4f1b8", "#002106", "#f6faf4", "#8a7a1f", "#fff"], D: ["#98d49f", "#135025", "#b4f1b8", "#0e1410", "#d6c46b", "#00390f"] },
  Sunset: { L: ["#9f401c", "#ffdbcf", "#380d00", "#fff8f5", "#c2185b", "#fff"], D: ["#ffb59a", "#7f2a05", "#ffdbcf", "#17100d", "#ff8fb1", "#5b1a00"] },
  Aurora: { L: ["#6845c2", "#e9ddff", "#23005c", "#faf7ff", "#0a9aa6", "#fff"], D: ["#c8b3ff", "#4b2d9a", "#e9ddff", "#0b0a16", "#4fe0cf", "#2a0c70"] },
  Mono: { L: ["#3b3b3b", "#e4e4e4", "#1b1b1b", "#fafafa", "#777", "#fff"], D: ["#e0e0e0", "#3a3a3a", "#f0f0f0", "#101010", "#9a9a9a", "#1a1a1a"] },
  Rose: { L: ["#952345", "#ffd6e2", "#470015", "#fdf7f9", "#a54027", "#ffffff"], D: ["#f896b3", "#6f2038", "#fecddc", "#170d10", "#f4937b", "#440417"] },
  Gold: { L: ["#745d1e", "#fef4d7", "#463402", "#fdfbf7", "#a2562a", "#ffffff"], D: ["#f6dd98", "#6d5922", "#fdf0ce", "#17140d", "#f1a87e", "#423205"] },
  Meadow: { L: ["#386b1f", "#e4fdd8", "#194404", "#f9fcf7", "#9f9f2d", "#ffffff"], D: ["#b8f39a", "#3c6b24", "#defbd0", "#10160d", "#eeee81", "#1a4107"] },
  Lagoon: { L: ["#1e6967", "#d8fdfc", "#044442", "#f7fcfc", "#2d6f9f", "#ffffff"], D: ["#9af3f0", "#246b68", "#d0fbfa", "#0d1616", "#81c1ee", "#07413f"] },
  Sky: { L: ["#226291", "#d6eeff", "#002a47", "#f7fafd", "#4627a5", "#ffffff"], D: ["#96cff8", "#204e6f", "#cdeafe", "#0d1317", "#997bf4", "#042944"] },
  Slate: { L: ["#455873", "#e2e9f3", "#152132", "#f9fafb", "#4d777f", "#ffffff"], D: ["#b3c4db", "#384557", "#dce4ef", "#101214", "#9fc8d0", "#172231"] },
  Plum: { L: ["#8c2b8c", "#fcd9fc", "#420542", "#fcf8fc", "#9c3066", "#ffffff"], D: ["#f19df1", "#692669", "#fad1fa", "#160e16", "#eb84b8", "#3f083f"] },
  Mocha: { L: ["#79593b", "#f6eadf", "#372210", "#fbfaf8", "#897743", "#ffffff"], D: ["#e2c5ac", "#5d4632", "#f3e5d8", "#15120f", "#d9c896", "#352312"] },
  Mint: { L: ["#246c49", "#dafbeb", "#074024", "#f8fcfa", "#339990", "#ffffff"], D: ["#9feec7", "#286747", "#d2f9e6", "#0e1612", "#87e8e0", "#0a3d24"] },
  Midnight: { L: ["#233a95", "#d6deff", "#000e47", "#f7f8fd", "#2790a5", "#ffffff"], D: ["#96a9f8", "#20306f", "#cdd7fe", "#0d0f17", "#7be0f4", "#041044"] },
  Candy: { L: ["#95235c", "#ffd6eb", "#470024", "#fdf7fa", "#2790a5", "#ffffff"], D: ["#f896c7", "#6f2047", "#fecde6", "#170d12", "#7be0f4", "#440424"] },
};

const rgb = (h: string): number[] => { h = h.replace("#", ""); if (h.length === 3) h = [...h].map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const hex = (c: number[]): string => "#" + c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
/** color-mix(in srgb, a p, b) */
export const mix = (a: string, p: number, b: string): string => hex(rgb(a).map((x, i) => x * p + rgb(b)[i]! * (1 - p)));
const lum = (h: string): number => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
export const ratio = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

export type Pair = { mode: "L" | "D"; token: string; on: string; ratio: number; need: number };
/** Every text pair of one colour set in both modes, with the ratio it must reach. */
export function pairs(name: string): Pair[] {
  const out: Pair[] = [];
  for (const mode of ["D", "L"] as const) {
    const a = ATM[name]![mode], d = mode === "D", tx = XDEF_TX[mode], t2 = TX2[mode], bg = a[3]!;
    const s = { bg, s1: mix(tx, d ? 0.05 : 0.03, bg), s2: mix(tx, d ? 0.1 : 0.07, bg), glow: mix(a[0]!, 0.2, bg) };
    for (const [on, v] of Object.entries(s)) {
      out.push({ mode, token: "tx", on, ratio: ratio(tx, v), need: 4.5 }, { mode, token: "tx2", on, ratio: ratio(t2, v), need: 4.5 }, { mode, token: "acc", on, ratio: ratio(a[0]!, v), need: 4.5 });
    }
    out.push({ mode, token: "on", on: "acc", ratio: ratio(a[5]!, a[0]!), need: 4.5 }, { mode, token: "onc", on: "accc", ratio: ratio(a[2]!, a[1]!), need: 4.5 });
  }
  return out;
}
