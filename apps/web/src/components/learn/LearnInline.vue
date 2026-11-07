<script setup lang="ts">
// Draws inline Markdown nodes through Vue's escaping, so text that looks like HTML stays text.
import type { Inline } from "@somnium/knowledge/markdown";
defineProps<{ nodes: Inline[] }>();
const emit = defineEmits<{ cite: [ids: string[]] }>();
const internal = (h: string) => h.startsWith("/learn");
const external = (h: string) => /^https?:/i.test(h);
</script>

<template>
  <template v-for="(n, i) in nodes" :key="i">
    <template v-if="n.t === 'text'">{{ n.text }}</template>
    <strong v-else-if="n.t === 'strong'"><LearnInline :nodes="n.children" @cite="emit('cite', $event)" /></strong>
    <em v-else-if="n.t === 'em'"><LearnInline :nodes="n.children" @cite="emit('cite', $event)" /></em>
    <code v-else-if="n.t === 'code'">{{ n.text }}</code>
    <router-link v-else-if="n.t === 'link' && internal(n.href)" :to="n.href"><LearnInline :nodes="n.children" @cite="emit('cite', $event)" /></router-link>
    <a v-else-if="n.t === 'link'" :href="n.href" :target="external(n.href) ? '_blank' : undefined" rel="noopener noreferrer"><LearnInline :nodes="n.children" @cite="emit('cite', $event)" /></a>
    <button v-else type="button" class="cite" :aria-label="'Source ' + n.ids.join(', ')" @click="emit('cite', n.ids)">{{ n.ids.join(", ") }}</button>
  </template>
</template>
