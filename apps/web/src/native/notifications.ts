// Whether this device lets Somnium show notifications (reminders, PLAN.md §9): the Android app asks Android (13+ needs
// the permission), a browser has its own; "unsupported" where there are none (a browser without them, such as Safari
// outside the home screen). Nothing here carries any content: the lock rules (CLAUDE.md) apply to every notification.
const cap = () => (globalThis as any).Capacitor;
const plugin = (name: string) => cap()?.Plugins?.[name];

export const isNativeApp = () => !!cap()?.isNativePlatform?.();
export type NotificationState = "granted" | "denied" | "prompt" | "unsupported";
export async function notificationState(): Promise<NotificationState> {
  const ln = plugin("LocalNotifications");
  if (ln) {
    try { const d = (await ln.checkPermissions())?.display; return d === "granted" ? "granted" : d === "denied" ? "denied" : "prompt"; }
    catch { return "unsupported"; }
  }
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission === "default" ? "prompt" : Notification.permission;
}
export async function askNotificationPermission() {
  const ln = plugin("LocalNotifications");
  try {
    if (ln) await ln.requestPermissions();
    else if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  } catch { /* the app works without them */ }
}

// Whether reminders will reach the person on this device, as one line and the one step that fixes it (LDJ-105).
// The long reasons (service workers, exact alarms, the tray) are in the reminders info sheet, not here.
export type DeliveryFix = "allow" | "exact" | "android" | "help" | "test";
export interface Delivery { tone: "ok" | "warn" | "bad"; text: string; fix: DeliveryFix }
export function reminderDelivery(p: { desktop: boolean; android: boolean; perm: NotificationState; exactAllowed: boolean | null; phone: boolean }): Delivery {
  if (p.desktop) return { tone: "ok", text: "Reminders will arrive", fix: "test" };
  if (p.perm === "unsupported") return { tone: "bad", text: "Notifications are not available here", fix: p.phone ? "android" : "help" };
  if (p.perm === "denied") return { tone: "bad", text: "Notifications blocked", fix: "help" };
  if (p.perm === "prompt") return { tone: "warn", text: "Notifications not allowed yet", fix: "allow" };
  if (p.android) return p.exactAllowed === false ? { tone: "warn", text: "Reminders may come a few minutes late", fix: "exact" } : { tone: "ok", text: "Reminders will arrive", fix: "test" };
  // a browser can't wake a closed page; a phone stops pages in the background, so there the Android app is the fix
  return { tone: "warn", text: "Only while Somnium is open", fix: p.phone ? "android" : "test" };
}
