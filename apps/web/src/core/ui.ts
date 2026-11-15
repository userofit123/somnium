// App-wide panels that any screen can open.
import { ref } from "vue";

export const appearanceOpen = ref(false);
/** The + sheet (shell/StartSheet.vue): the phone's centre tab, the desktop's + button, or N */
export const startOpen = ref(false);
/** The command palette (shell/CommandPalette.vue): Ctrl+K or the rail's Search hint */
export const paletteOpen = ref(false);
