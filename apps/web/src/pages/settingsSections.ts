// Settings' sections in one place: SettingsPage draws its list from this and the command palette lists the same ones,
// so a new or renamed section can't show in one and not the other.

/** [key, name, icon, what's in it] */
export type Section = [key: string, name: string, icon: string, hint: string];

/** In groups, in the order of PLAN.md §6.7. The server-only admin section is added by the page when it applies. */
export function settingsGroups(opts: { multiServer?: boolean; admin?: boolean } = {}): [string, Section[]][] {
  return [
    ["You", [["account", "Account", "user", "Name, devices, sync"],
      // the apps keep several servers and on-device accounts; in a browser the server is the site, so this only names it
      opts.multiServer ? ["accounts", "Servers & accounts", "server", "Switch, add or remove a server"] : ["accounts", "Server", "server", "Where your journal syncs"],
      ["security", "Security", "lock", "App lock, password, two-factor, recovery"]]],
    // what changes how the app helps you dream, before how it looks
    ["Practice", [["sleep", "Sleep schedule", "moon", "Bedtime, wake time, cycle length, nights to sleep in"], ["reminders", "Reminders", "bell", "Reality checks, bedtime, wake-up alarm, morning"],
      ["reality-checks", "Reality checks", "eye", "How many, when, which checks"], ["features", "Features", "sparkle", "Voice notes, photos, goals and more"]]],
    ["App", [["appearance", "Appearance", "palette", "Colours, style, layout"], ["formats", "Formats", "calendar", "Week start, dates, clock"]]],
    ["Your data", [["backup", "Backups", "download", "Back up, restore"], ["data", "Export & import", "upload", "Save your dreams as files, bring in another journal"], ["log", "Activity log", "history", "Everything you changed"]]],
    ["About", [...(opts.admin ? [["admin", "Server admin", "server", "People, invites, sign-ups"] as Section] : []), ["about", "About and updates", "info", "Version, updates, release notes, credits"]]],
  ];
}
