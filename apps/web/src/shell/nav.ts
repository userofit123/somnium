// The pages in the menu (PLAN.md §6.0): seven on a computer (daily pages first, reference pages last), and on the
// phone the tabs below plus More (Dream signs, Learn, Settings). The command palette lists NAV, so it follows.
export const NAV = [
  { name: "home", label: "Home", icon: "home", to: "/" },
  { name: "journal", label: "Journal", icon: "book", to: "/journal" },
  { name: "train", label: "Train", icon: "target", to: "/train" },
  { name: "signs", label: "Dream signs", icon: "eye", to: "/signs" },
  { name: "progress", label: "Progress", icon: "stats", to: "/progress" },
  { name: "learn", label: "Learn", icon: "graduation", to: "/learn" },
  { name: "settings", label: "Settings", icon: "settings", to: "/settings" },
];
/** Which menu item a page belongs to (a dream's own page belongs to the Journal, an element's to Dream signs, a report to Progress,
 *  Train's tabs and sub-screens to Train) */
export function section(routeName: string | undefined): string {
  if (routeName?.startsWith("journal")) return "journal";
  if (routeName?.startsWith("signs")) return "signs";
  if (routeName === "report") return "progress";
  if (routeName?.startsWith("train")) return "train";
  return routeName ?? "";
}
/** Train's three tabs (PLAN.md §6.3): one page between them in the shells, so moving between tabs doesn't swap the page */
export const TRAIN_TABS = ["train", "train-tonight", "train-techniques"];
