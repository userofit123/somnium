<script setup lang="ts">
// A note on a reality check just logged from /check. Notes are sealed, so this page is behind the lock like the rest.
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { send } from "../api/outbox";
import { invalidate } from "../api/live";
import { toastError } from "../core/toast";

const route = useRoute(), router = useRouter();
const note = ref(""), busy = ref(false);
async function save() {
  busy.value = true;
  try { await send("put", `/reality-checks/${encodeURIComponent(String(route.params.id))}`, { note: note.value.trim() || null }); invalidate(["checks"]); router.replace("/train"); }
  catch (e) { toastError(e); }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="page">
    <div class="ph"><div><h1>Note on your check</h1></div></div>
    <div class="card stack">
      <div class="fld"><label for="rc-note">What did you notice?</label><textarea id="rc-note" v-model="note" rows="4" maxlength="2000" /></div>
      <div class="row"><button class="btn" :disabled="busy" @click="save">Save</button><button class="btn o s" type="button" @click="router.replace('/train')">Skip</button></div>
    </div>
  </div>
</template>
