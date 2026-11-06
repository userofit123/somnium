<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { asking } from "../core/ask";
import Sheet from "./Sheet.vue";

const inp = ref<HTMLInputElement | null>(null);
watch(() => asking.cur, async (c) => { if (c?.input) { await nextTick(); inp.value?.focus(); inp.value?.select(); } });
function done(v: unknown) { const c = asking.cur; asking.cur = null; c?.resolve(v); }
const cancel = () => done(asking.cur?.input || asking.cur?.choices ? null : false);
// what the typed answer gives back: a password exactly as typed, other text trimmed; nothing typed = no answer
const typed = () => { const i = asking.cur?.input; if (!i) return true; return (i.secret ? i.value : i.value.trim()) || null; };
const empty = () => !!asking.cur?.input?.secret && !asking.cur.input.value;
</script>

<template>
  <Sheet v-if="asking.cur" :title="asking.cur.title" :no-history="asking.cur.noHistory" @close="cancel">
    <p v-if="asking.cur.text" class="muted hgap" style="line-height:1.5">{{ asking.cur.text }}</p>
    <input v-if="asking.cur.input" ref="inp" v-model="asking.cur.input.value" class="in" :type="asking.cur.input.secret ? 'password' : 'text'" :autocomplete="asking.cur.input.autocomplete" :placeholder="asking.cur.input.placeholder" @keydown.enter="!empty() && done(typed())" />
    <div v-if="asking.cur.choices" class="opt-list">
      <button v-for="c in asking.cur.choices" :key="c.value" class="optb" @click="done(c.value)"><span class="t">{{ c.label }}</span></button>
    </div>
    <template v-if="!asking.cur.choices" #foot>
      <button class="btn o" @click="cancel">{{ asking.cur.no ?? "Cancel" }}</button>
      <button class="btn" :class="{ r: asking.cur.danger }" :disabled="empty()" @click="done(typed())">{{ asking.cur.ok }}</button>
    </template>
  </Sheet>
</template>
