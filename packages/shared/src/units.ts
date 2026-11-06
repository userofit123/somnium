// Display helpers for numbers and lengths of time.

/** A number for display: at most `dp` decimals, no trailing zeros. */
export function num(v: number | null | undefined, dp = 1): string {
  if (v == null || !Number.isFinite(v)) return "";
  const f = 10 ** dp;
  const r = Math.round(v * f) / f;
  return r.toLocaleString("en-US", { maximumFractionDigits: dp, useGrouping: Math.abs(r) >= 1000 });
}

/** 0:45, 1:30, 1:02:03 */
export function clock(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** 45s, 1m 30s, 1h 5m - one compact form for every length of time in the app (timers, sleep, practices);
 *  `short` leaves the seconds off once there are minutes ("~45m"). */
export function duration(totalS: number, short = false): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return short || !r ? `${m}m` : `${m}m ${r}s`;
  return short && !r ? "0m" : `${r}s`;
}
