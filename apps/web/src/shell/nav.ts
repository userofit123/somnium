// The pages in the menu (PLAN.md §6): seven on a computer, five tabs plus More on the phone.
export const NAV = [
  { name: "home", label: "Home", icon: "home", to: "/" },
  { name: "journal", label: "Journal", icon: "note", to: "/journal" },
  { name: "signs", label: "Signs", icon: "sparkle", to: "/signs" },
  { name: "train", label: "Train", icon: "target", to: "/train" },
  { name: "insights", label: "Insights", icon: "stats", to: "/insights" },
  { name: "learn", label: "Learn", icon: "info", to: "/learn" },
  { name: "settings", label: "Settings", icon: "settings", to: "/settings" },
];
/** Which menu item a page belongs to (a dream's own page belongs to the Journal, say) */
export function section(routeName: string | undefined): string {
  return routeName ?? "";
}
