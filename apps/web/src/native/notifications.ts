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
