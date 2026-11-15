<script setup lang="ts">
// A number with − and + on either side and its unit after it; the number can also be typed.
// big: a thumb-sized version for the phone
const props = defineProps<{ value: number | null; step?: number; min?: number; max?: number; unit?: string; label?: string; big?: boolean }>();
const emit = defineEmits<{ set: [v: number] }>();
const clamp = (v: number) => Math.min(props.max ?? Infinity, Math.max(props.min ?? 0, Math.round(v * 100) / 100));
const bump = (d: number) => emit("set", clamp((props.value ?? 0) + d * (props.step ?? 1)));
function typed(e: Event) {
  const v = Number((e.target as HTMLInputElement).value.replace(",", "."));
  if (Number.isFinite(v)) emit("set", clamp(v)); else (e.target as HTMLInputElement).value = String(props.value ?? "");
}
</script>

<template>
  <div class="nstep" :class="{ big }">
    <button type="button" :aria-label="`Less${label ? ' ' + label : ''}`" :disabled="value != null && value <= (min ?? 0)" @click="bump(-1)">−</button>
    <label><input inputmode="decimal" :value="value ?? ''" :aria-label="label" @change="typed" /><span v-if="unit">{{ unit }}</span></label>
    <button type="button" :aria-label="`More${label ? ' ' + label : ''}`" :disabled="value != null && max != null && value >= max" @click="bump(1)">+</button>
  </div>
</template>

<style scoped>
.nstep { display: inline-flex; align-items: center; border: 1px solid var(--ol); border-radius: var(--pill); background: var(--s1); height: 38px; flex: none; }
.nstep button { width: 36px; height: 100%; border: 0; background: none; color: var(--tx2); font-size: calc(18px * var(--fsc)); cursor: pointer; border-radius: var(--pill); }
.nstep button:hover:not(:disabled) { color: var(--acc); background: var(--s2); }
.nstep button:disabled { opacity: .35; cursor: default; }
.nstep label { display: inline-flex; align-items: baseline; gap: calc(var(--hg) * .3); padding: 0 2px; }
.nstep input { width: 4ch; min-width: 0; border: 0; background: none; padding: 0; text-align: center; font-size: calc(15px * var(--fsc)); font-weight: 600; font-variant-numeric: tabular-nums; color: var(--tx); }
.nstep input:focus { outline: none; }
.nstep span { font-size: var(--fs-sm); color: var(--tx2); }
.nstep.big { height: 48px; }
.nstep.big button { width: 44px; font-size: calc(22px * var(--fsc)); }
.nstep.big input { font-size: calc(20px * var(--fsc)); width: 4.2ch; }
</style>
