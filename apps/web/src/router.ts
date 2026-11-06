import { createRouter, createWebHistory } from "vue-router";

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
    { path: "/train", name: "train", component: () => import("./pages/TrainPage.vue") },
    { path: "/insights", name: "insights", component: () => import("./pages/InsightsPage.vue") },
    { path: "/learn", name: "learn", component: () => import("./pages/LearnPage.vue") },
    { path: "/more", name: "more", component: () => import("./pages/MorePage.vue") },
    { path: "/settings/:section?", name: "settings", component: () => import("./pages/SettingsPage.vue") },
    { path: "/:rest(.*)", redirect: "/" },
  ],
});
