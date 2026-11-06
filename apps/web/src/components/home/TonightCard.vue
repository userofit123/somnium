<script setup lang="ts">
// "Tonight" (PLAN.md §6.1): the techniques planned for tonight's night (Train's plan), each linking to its page, and
// the intention, edited here and saved sealed on the night (api/home.ts). "Plan tonight" goes to Train.
import { ref, watch } from "vue";
import { saveIntention } from "../../api/home";
import { useChange } from "../../api/queries";
import Icon from "../Icon.vue";

const props = defineProps<{ date: string; same: boolean; planned: { id: string; title: string }[]; intention: string }>();
const text = ref(props.intention);
const editing = ref(false);
watch(() => props.intention, (v) => { if (!editing.value) text.value = v; });
const save = useChange(async () => { await saveIntention(props.date, text.value); editing.value = false; }, ["journal", "home"]);
const cancel = () => { text.value = props.intention; editing.value = false; };
</script>

<template>
  <section class="htonight">
    <div class="sh"><h2>Tonight</h2><router-link v-if="planned.length" to="/train" class="lnk">Change</router-link></div>
    <div class="card">
      <div v-if="same" class="tiny hnote">Before 05:00 tonight is the night you are in.</div>
      <div v-if="planned.length" class="hplan">
        <router-link v-for="p in planned" :key="p.id" :to="{ path: '/train', query: { technique: p.id } }" class="li hli">
          <Icon name="moon" :size="18" /><span class="grow t">{{ p.title }}</span><Icon name="right" :size="16" />
        </router-link>
      </div>
      <div v-else class="hrow">
        <div class="grow tiny">Nothing planned yet.</div>
        <router-link to="/train" class="btn o s">Plan tonight</router-link>
      </div>
      <div class="hint">
        <div v-if="!editing" class="hrow">
          <div class="grow"><div class="t">Intention</div><div class="tiny hintx">{{ intention || "None set" }}</div></div>
          <button type="button" class="qb acc" @click="editing = true"><Icon name="edit" :size="16" />{{ intention ? "Change" : "Set an intention" }}</button>
        </div>
        <form v-else class="hedit" @submit.prevent="save.run()">
          <label class="t" for="h-intention">Intention</label>
          <input id="h-intention" v-model="text" type="text" maxlength="200" placeholder="Next time I dream, I will notice I am dreaming" autocomplete="off" @keydown.esc="cancel" />
          <div class="hrow"><span class="grow" /><button type="button" class="qb" @click="cancel">Cancel</button><button type="submit" class="btn o s" :disabled="save.busy.value">Save</button></div>
        </form>
      </div>
    </div>
  </section>
</template>
