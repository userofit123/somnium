// Numbers and dates as the person likes them (Settings → Account → formats).
import { computed } from "vue";
import { num, clock, duration as dur, type Settings } from "@somnium/shared";
import { useSettings } from "../api/queries";

export function useFmt() {
  const s = useSettings();
  return computed(() => makeFmt(s.value));
}
export function makeFmt(s: Settings) {
  const locale = s.dateFormat === "mdy" ? "en-US" : s.dateFormat === "ymd" ? "sv-SE" : "en-GB";
  const hour12 = s.clock === "12";
  return {
    s,
    clock, dur,
    date: (iso: string | null | undefined, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(locale, o) : ""),
    dateLong: (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""),
    time: (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", hour12 }) : ""),
    ago: (iso: string | null | undefined) => ago(iso),
    num,
  };
}
export type Fmt = ReturnType<typeof makeFmt>;

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso), now = new Date();
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}
export const localYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
