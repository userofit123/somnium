// One version comparison for the server's update check and the apps' own (a release beats its prereleases).
const parse = (v: string) => {
  const [core, pre] = v.trim().replace(/^v/i, "").split("+")[0]!.split(/-(.*)/s);
  return { nums: (core ?? "").split(".").map((x) => parseInt(x) || 0), pre: pre ? pre.split(".") : [] };
};

/** Whether version a is newer than b: "1.10.0" > "1.9.2", "1.3.0" > "1.3.0-beta.1", "1.3.0-beta.2" > "1.3.0-beta.1". */
export function newer(a: string, b: string): boolean {
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) if ((pa.nums[i] ?? 0) !== (pb.nums[i] ?? 0)) return (pa.nums[i] ?? 0) > (pb.nums[i] ?? 0);
  if (!pa.pre.length || !pb.pre.length) return !pa.pre.length && pb.pre.length > 0;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i], y = pb.pre[i];
    if (x === undefined) return false; // fewer identifiers sorts first
    if (y === undefined) return true;
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) > Number(y);
    if (nx !== ny) return ny; // numbers sort before words
    return x > y;
  }
  return false;
}
