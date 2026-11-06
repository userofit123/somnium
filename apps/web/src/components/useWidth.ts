// The live pixel width of an element, so charts can draw at their real size (text and dots are never stretched).
import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

export function useWidth(el: Ref<HTMLElement | null>, fallback = 600) {
  const w = ref(fallback);
  let ro: ResizeObserver | null = null;
  onMounted(() => {
    if (!el.value) return;
    w.value = el.value.clientWidth || fallback;
    ro = new ResizeObserver(() => { if (el.value?.clientWidth) w.value = el.value.clientWidth; });
    ro.observe(el.value);
  });
  onBeforeUnmount(() => ro?.disconnect());
  return w;
}
