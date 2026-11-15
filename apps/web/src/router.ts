import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";
import { localYmd } from "./core/format";

const TrainPage = () => import("./pages/TrainPage.vue");
// LDJ-80: a new dream for today's date (Home's "Write last night's dream", the WBTB guide's "Write down the last
// dream", the phone's + in the morning, the Journal's "+ Dream" on today's row, the morning reminder) starts in the
// morning capture, still and dim, key words first (RESEARCH.md C1, C2). Without a date (the Journal's own "Write a
// dream") it is the plain editor. The capture's "Write it out" opens the editor without new=1, so it is not sent round
// again. From router.beforeEach, for the reason given below.
function captureFirst(to: RouteLocationNormalized) {
  const q = to.query, today = localYmd(new Date());
  if (q.new !== "1" || q.date !== today) return true;
  return { name: "capture", query: { date: today, id: String(to.params.id), new: "1" } };
}
// links from before Train's sub-screens had addresses: reminders, bookmarks, recommendations already shown. Run from
// router.beforeEach, not the route's beforeEnter: vue-router skips beforeEnter when only the query changes, so a reminder
// pushing /train?guided=up while Train is already open would otherwise do nothing
function oldTrainLink(to: RouteLocationNormalized) {
  const q = to.query, one = (k: string) => (typeof q[k] === "string" && q[k] ? encodeURIComponent(q[k] as string) : "");
  if (one("technique")) return `/train/technique/${one("technique")}`;
  if (one("lesson")) return `/train/lesson/${one("lesson")}`;
  if (one("guided")) return `/train/guided/${one("guided")}`;
  if ("review" in q) return "/train/review"; // "?review" alone parses as null, so test for the key
  return true;
}

export const router = createRouter({
  history: createWebHistory(),
  // pages fade out before the next one comes in (see the shells), so scroll once the old page is gone. Going Back returns
  // to where you were: the page's data may still be arriving, so wait (up to 2 s) until it is tall enough to scroll there
  scrollBehavior: (to, from, saved) => to.path === from.path ? undefined : new Promise((ok) => {
    const t0 = Date.now();
    const ready = () => !saved || document.documentElement.scrollHeight - innerHeight >= saved.top - 2 || Date.now() - t0 > 2000;
    const tick = () => (ready() ? ok(saved ?? { top: 0 }) : requestAnimationFrame(tick));
    setTimeout(tick, 130);
  }),
  routes: [
    { path: "/", name: "home", component: () => import("./pages/HomePage.vue") },
    { path: "/journal", name: "journal", component: () => import("./pages/JournalPage.vue") },
    // a dream to read, or to write (a new one gets its id before the first word, so a draft is never without one)
    { path: "/journal/dream/:id", name: "journal-dream", component: () => import("./pages/JournalPage.vue") },
    { path: "/journal/write/:id", name: "journal-write", component: () => import("./pages/JournalPage.vue") },
    // the morning capture (LDJ-80): full screen, drawn by App.vue in place of the shells, behind the lock
    { path: "/capture", name: "capture", component: () => import("./components/journal/CaptureView.vue") },
    { path: "/signs", name: "signs", component: () => import("./pages/SignsPage.vue") },
    // an element's page: beside the list on a computer, a step of its own on the phone
    { path: "/signs/:id", name: "signs-element", component: () => import("./pages/SignsPage.vue") },
    // Train's three tabs (PLAN.md §6.3), each its own address so Home and reminders can link straight to one, and its
    // sub-screens. The old query links (/train?technique=, ?lesson=, ?guided=, ?review=1) still land on them.
    { path: "/train", name: "train", component: TrainPage },
    { path: "/train/tonight", name: "train-tonight", component: TrainPage },
    { path: "/train/techniques", name: "train-techniques", component: TrainPage },
    { path: "/train/technique/:id", name: "train-technique", component: TrainPage },
    { path: "/train/lesson/:id", name: "train-lesson", component: TrainPage },
    { path: "/train/guided/:mode", name: "train-guided", component: TrainPage },
    { path: "/train/review", name: "train-review", component: TrainPage },
    { path: "/progress", name: "progress", component: () => import("./pages/InsightsPage.vue") },
    // the page was called Insights; old links and bookmarks still land on it
    { path: "/insights", redirect: "/progress" },
    { path: "/report", name: "report", component: () => import("./pages/ReportPage.vue") },
    { path: "/learn/:sub(.*)?", name: "learn", component: () => import("./pages/LearnPage.vue") },
    // a reality check from a reminder or by hand: App.vue shows it over the lock screen; its note is a page behind the lock
    { path: "/check", name: "check", component: () => import("./shell/CheckScreen.vue") },
    { path: "/check/note/:id", name: "check-note", component: () => import("./pages/CheckNotePage.vue") },
    { path: "/more", name: "more", component: () => import("./pages/MorePage.vue") },
    { path: "/settings/:section?", name: "settings", component: () => import("./pages/SettingsPage.vue") },
    { path: "/:rest(.*)", redirect: "/" },
  ],
});

router.beforeEach((to) => {
  if (to.name === "journal-write") return captureFirst(to);
  return to.name === "train" && Object.keys(to.query).length ? oldTrainLink(to) : true;
});
