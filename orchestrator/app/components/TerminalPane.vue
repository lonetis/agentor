<script setup lang="ts">
const props = defineProps<{
  containerId: string;
}>();

const { $Terminal, $FitAddon } = useNuxtApp();

const containerIdRef = toRef(props, 'containerId');

const defaultWindow = 'main';

const {
  windows,
  activeWindowName,
  createWindow,
  renameWindow,
  closeWindow,
  activateWindow,
  destroy: destroyTmuxTabs,
} = useTmuxTabs(containerIdRef);

// Map of window name -> terminal instance + element ref
const terminals = new Map<
  string,
  { instance: ReturnType<typeof useTerminal>; el: HTMLElement | null }
>();

// Template refs for terminal containers
const terminalRefs = new Map<string, HTMLElement>();
function setTerminalRef(name: string, el: Element | null | ComponentPublicInstance) {
  const htmlEl = (el as ComponentPublicInstance)?.$el ?? el;
  if (htmlEl instanceof HTMLElement) {
    terminalRefs.set(name, htmlEl);
  } else {
    terminalRefs.delete(name);
  }
}

// Container element for ResizeObserver
const terminalsContainer = ref<HTMLElement | null>(null);

function ensureTerminal(windowName: string) {
  if (terminals.has(windowName)) return;
  const instance = useTerminal();
  terminals.set(windowName, { instance, el: null });
}

function connectTerminal(windowName: string) {
  const entry = terminals.get(windowName);
  const el = terminalRefs.get(windowName);
  if (!entry || !el || !$Terminal || !$FitAddon) return;

  entry.el = el;
  el.innerHTML = '';
  entry.instance.openTerminal(props.containerId, windowName, el, $Terminal, $FitAddon);
}

function destroyTerminal(windowName: string) {
  const entry = terminals.get(windowName);
  if (!entry) return;
  entry.instance.destroy();
  terminals.delete(windowName);
  terminalRefs.delete(windowName);
}

async function onRename(oldName: string, newName: string) {
  // Re-key maps optimistically BEFORE the async call so the watcher
  // (which fires as a microtask after renameWindow mutates windows)
  // sees the new key and doesn't destroy the live terminal.
  const entry = terminals.get(oldName);
  if (entry) {
    terminals.delete(oldName);
    terminals.set(newName, entry);
  }
  const el = terminalRefs.get(oldName);
  if (el) {
    terminalRefs.delete(oldName);
    terminalRefs.set(newName, el);
  }

  const success = await renameWindow(oldName, newName);
  if (!success) {
    // Undo re-keying on failure
    const entry = terminals.get(newName);
    if (entry) {
      terminals.delete(newName);
      terminals.set(oldName, entry);
    }
    const el = terminalRefs.get(newName);
    if (el) {
      terminalRefs.delete(newName);
      terminalRefs.set(oldName, el);
    }
  }
}

// Watch windows list — create/destroy terminal instances as needed
watch(
  windows,
  (newWindows) => {
    const currentNames = new Set(newWindows.map((w) => w.name));

    // Destroy terminals for removed windows
    for (const name of terminals.keys()) {
      if (!currentNames.has(name)) {
        destroyTerminal(name);
      }
    }

    // Ensure terminal instances exist for all windows (but don't connect hidden ones yet)
    for (const w of newWindows) {
      ensureTerminal(w.name);
    }

    // Only connect the active window after DOM update
    nextTick(() => {
      const active = activeWindowName.value;
      if (active) {
        const entry = terminals.get(active);
        if (entry && !entry.el) {
          connectTerminal(active);
        }
      }
    });
  },
  { deep: true },
);

// When active tab changes: connect if needed, then refit
watch(activeWindowName, (name) => {
  if (!name) return;
  nextTick(() => {
    const entry = terminals.get(name);
    if (!entry) return;
    if (!entry.el) {
      // Lazily connect terminal when it first becomes visible
      connectTerminal(name);
    } else {
      // Already connected — just refit for the now-visible element
      entry.instance.fitTerminal();
    }
  });
});

// ResizeObserver for all resize scenarios
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  if (!terminalsContainer.value) return;
  resizeObserver = new ResizeObserver(() => {
    if (!activeWindowName.value) return;
    const entry = terminals.get(activeWindowName.value);
    entry?.instance.fitTerminal(false);
  });
  resizeObserver.observe(terminalsContainer.value);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  for (const name of [...terminals.keys()]) {
    destroyTerminal(name);
  }
  destroyTmuxTabs();
});
</script>

<template>
  <div class="absolute inset-0 flex flex-col" style="background: var(--terminal-bg);">
    <TmuxTabBar
      :windows="windows"
      :active-window-name="activeWindowName"
      :default-window="defaultWindow"
      @activate="activateWindow"
      @close="closeWindow"
      @create="createWindow"
      @rename="onRename"
    />

    <div ref="terminalsContainer" class="relative flex-1 min-h-0">
      <div
        v-for="w in windows"
        :key="w.index"
        v-show="w.name === activeWindowName"
        :ref="(el) => setTerminalRef(w.name, el)"
        class="absolute inset-0"
      />
    </div>
  </div>
</template>
