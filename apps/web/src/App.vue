<script setup lang="ts">
// The frame: sign-in until someone is signed in, the lock screen until they prove it is them (nothing behind it is
// mounted, so no dream is in the page), then the desktop or the phone layout, plus the panels any screen can open.
import { computed, onMounted, watch } from "vue";
import { session, loadSession } from "./core/session";
import { isPhone } from "./core/device";
import { startLive, stopLive } from "./api/live";
import AuthScreen from "./shell/AuthScreen.vue";
import DesktopShell from "./shell/DesktopShell.vue";
import PhoneShell from "./shell/PhoneShell.vue";
import Overlays from "./shell/Overlays.vue";
import Toasts from "./components/Toasts.vue";
import AskHost from "./components/AskHost.vue";
import AccountChooser from "./shell/AccountChooser.vue";
import LockScreen from "./shell/LockScreen.vue";
import { lock, resumeAfterReload, startLock } from "./core/lock";
import { isAndroid, installAndroidBridge } from "./native/android";
import { connect } from "./native/accounts";
import { startStatusReports } from "./core/accounts";
import { ref, defineAsyncComponent } from "vue";
import { useRoute } from "vue-router";
import { startReminders, stopReminders } from "./native/reminders";
import { useSetupGate } from "./components/setup/useSetup";

// in the Android app, the open account decides where the data is (on the phone or on a server)
const needAccount = ref(false);
startLock();
onMounted(async () => {
  if (isAndroid()) { installAndroidBridge(); if (!(await connect())) { needAccount.value = true; return; } }
  // a reload within the lock's delay opens without the lock screen (core/resume.ts); the splash stays up until that's known
  try { await loadSession(); } finally { await resumeAfterReload(); }
  // the desktop and Android apps show each account's sync in their lists: the open one reports it as it changes
  void startStatusReports();
});
const signedIn = computed(() => session.ready && !!session.user);
watch(signedIn, (v) => (v ? startLive() : stopLive()), { immediate: true });
// reality check reminders (PLAN.md §9) run whenever someone is signed in, locked or not: their words carry nothing sealed
watch(signedIn, (v) => (v ? startReminders() : stopReminders()), { immediate: true });
// a reminder's tap opens /check over the lock screen: it shows nothing from the journal and writes only unsealed fields
const route = useRoute();
const CheckScreen = defineAsyncComponent(() => import("./shell/CheckScreen.vue"));
// the first-run setup (LDJ-77): once, after the lock is open, in place of the shells; the splash stays while it is not
// yet known, so Home doesn't flash first
const SetupScreen = defineAsyncComponent(() => import("./components/setup/SetupScreen.vue"));
// the morning capture (LDJ-80) fills the screen in place of the shells, and only once the lock is open: it writes the
// journal, which is sealed, so unlike /check it never opens over the lock screen
const CaptureView = defineAsyncComponent(() => import("./components/journal/CaptureView.vue"));
const setup = useSetupGate();
</script>

<template>
  <AccountChooser v-if="needAccount" />
  <div v-else-if="!session.ready || lock.resuming || (!lock.locked && session.user && setup.pending.value)" id="splash"><i><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><g transform="translate(.6 -.6)"><path fill-rule="evenodd" d="M11.27 5.25A7.31 7.31 0 1 0 17.99 14.9A5.91 5.91 0 0 1 11.27 5.25ZM5.6 14.6Q8.4 11.64 11.2 14.6Q8.4 17.56 5.6 14.6Z"/><circle cx="8.4" cy="14.6" r="1.2"/><path d="M17.44 7.03l.38 1.03 1.03.38-1.03.38-.38 1.03-.38-1.03-1.03-.38 1.03-.38z"/></g></svg></i></div>
  <AuthScreen v-else-if="!session.user" />
  <Suspense v-else-if="route.path === '/check'"><CheckScreen /></Suspense>
  <LockScreen v-else-if="lock.locked" />
  <SetupScreen v-else-if="setup.show.value" />
  <template v-else-if="route.path === '/capture'"><Suspense><CaptureView /></Suspense><Overlays /></template>
  <template v-else>
    <PhoneShell v-if="isPhone" />
    <DesktopShell v-else />
    <Overlays />
  </template>
  <Toasts />
  <!-- the account chooser asks its own questions, before anyone is signed in; nothing else may ask until the journal is open -->
  <AskHost v-if="needAccount || (session.user && !lock.locked)" />
</template>
