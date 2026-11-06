<script setup lang="ts">
// The frame: sign-in until someone is signed in, then the desktop or the phone layout, plus the panels any screen can open.
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
import { isAndroid, installAndroidBridge } from "./native/android";
import { connect } from "./native/accounts";
import { ref } from "vue";

// in the Android app, the open account decides where the data is (on the phone or on a server)
const needAccount = ref(false);
onMounted(async () => {
  if (isAndroid()) { installAndroidBridge(); if (!(await connect())) { needAccount.value = true; return; } }
  await loadSession();
});
const signedIn = computed(() => session.ready && !!session.user);
watch(signedIn, (v) => (v ? startLive() : stopLive()), { immediate: true });
</script>

<template>
  <AccountChooser v-if="needAccount" />
  <div v-else-if="!session.ready" id="splash"><i style="color:var(--on)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 16.5 8.5 11.5l4 3.5 6-6.5" /><circle cx="18.5" cy="8.5" r="2.4" fill="currentColor" stroke="none" /></svg></i></div>
  <AuthScreen v-else-if="!session.user" />
  <template v-else>
    <PhoneShell v-if="isPhone" />
    <DesktopShell v-else />
    <Overlays />
  </template>
  <Toasts />
  <AskHost />
</template>
