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
import { lock, startLock } from "./core/lock";
import { isAndroid, installAndroidBridge } from "./native/android";
import { connect } from "./native/accounts";
import { ref, defineAsyncComponent } from "vue";
import { useRoute } from "vue-router";
import { startReminders, stopReminders } from "./native/reminders";

// in the Android app, the open account decides where the data is (on the phone or on a server)
const needAccount = ref(false);
startLock();
onMounted(async () => {
  if (isAndroid()) { installAndroidBridge(); if (!(await connect())) { needAccount.value = true; return; } }
  await loadSession();
});
const signedIn = computed(() => session.ready && !!session.user);
watch(signedIn, (v) => (v ? startLive() : stopLive()), { immediate: true });
// reality check reminders (PLAN.md §9) run whenever someone is signed in, locked or not: their words carry nothing sealed
watch(signedIn, (v) => (v ? startReminders() : stopReminders()), { immediate: true });
// a reminder's tap opens /check over the lock screen: it shows nothing from the journal and writes only unsealed fields
const route = useRoute();
const CheckScreen = defineAsyncComponent(() => import("./shell/CheckScreen.vue"));
</script>

<template>
  <AccountChooser v-if="needAccount" />
  <div v-else-if="!session.ready" id="splash"><i style="color:var(--on)"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><g transform="translate(.6 -.6)"><path fill-rule="evenodd" d="M11.27 5.25A7.31 7.31 0 1 0 17.99 14.9A5.91 5.91 0 0 1 11.27 5.25ZM5.6 14.6Q8.4 11.64 11.2 14.6Q8.4 17.56 5.6 14.6Z"/><circle cx="8.4" cy="14.6" r="1.2"/><path d="M17.44 7.03l.38 1.03 1.03.38-1.03.38-.38 1.03-.38-1.03-1.03-.38 1.03-.38z"/></g></svg></i></div>
  <AuthScreen v-else-if="!session.user" />
  <Suspense v-else-if="route.path === '/check'"><CheckScreen /></Suspense>
  <LockScreen v-else-if="lock.locked" />
  <template v-else>
    <PhoneShell v-if="isPhone" />
    <DesktopShell v-else />
    <Overlays />
  </template>
  <Toasts />
  <!-- the account chooser asks its own questions, before anyone is signed in; nothing else may ask until the journal is open -->
  <AskHost v-if="needAccount || (session.user && !lock.locked)" />
</template>
