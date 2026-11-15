import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";

const TrainPage = () => import("./pages/TrainPage.vue");
// links from before Train's sub-screens had addresses: reminders, bookmarks, recommendations already shown
function oldTrainLink(to: RouteLocationNormalized) {
  const q = to.query, one = (k: string) => (typeof q[k] === "string" && q[k] ? encodeURIComponent(q[k] as string) : "");
  if (one("technique")) return `/train/technique/${one("technique")}`;
  if (one("lesson")) return `/train/lesson/${one("lesson")}`;
  if (one("guided")) return `/train/guided/${one("guided")}`;
  if (q.review) return "/train/review";
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
    { path: "/signs", name: "signs", component: () => import("./pages/SignsPage.vue") },
    // an element's page: beside the list on a computer, a step of its own on the phone
    { path: "/signs/:id", name: "signs-element", component: () => import("./pages/SignsPage.vue") },
    // Train's three tabs (PLAN.md §6.3), each its own address so Home and reminders can link straight to one, and its
    // sub-screens. The old query links (/train?technique=, ?lesson=, ?guided=, ?review=1) still land on them.
    { path: "/train", name: "train", component: TrainPage, beforeEnter: oldTrainLink },
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
