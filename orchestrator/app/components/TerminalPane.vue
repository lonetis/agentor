<script setup lang="ts">
const props = defineProps<{
  containerId: string;
}>();

const { $Terminal, $FitAddon } = useNuxtApp();

const containerIdRef = toRef(props, 'containerId');

const {
  windows,
  activeWindowIndex,
  defaultWindowIndex,
  createWindow,
  renameWindow,
  closeWindow,
  activateWindow,
  destroy: destroyTmuxTabs,
} = useTmuxTabs(containerIdRef);

// Map of window index -> terminal instance + element ref
const terminals = new Map<
  number,
  { instance: ReturnType<typeof useTerminal>; el: HTMLElement | null }
>();

// Template refs for terminal containers
const terminalRefs = new Map<number, HTMLElement>();
function setTerminalRef(index: number, el: Element | null | ComponentPublicInstance) {
  const htmlEl = (el as ComponentPublicInstance)?.$el ?? el;
  if (htmlEl instanceof HTMLElement) {
    terminalRefs.set(index, htmlEl);
  } else {
    terminalRefs.delete(index);
  }
}

// Container element for ResizeObserver
const terminalsContainer = ref<HTMLElement | null>(null);

function ensureTerminal(windowIndex: number) {
  if (terminals.has(windowIndex)) return;
  const instance = useTerminal();
  terminals.set(windowIndex, { instance, el: null });
}

function connectTerminal(windowIndex: number) {
  const entry = terminals.get(windowIndex);
  const el = terminalRefs.get(windowIndex);
  if (!entry || !el || !$Terminal || !$FitAddon) return;

  entry.el = el;
  el.innerHTML = '';
  entry.instance.openTerminal(props.containerId, windowIndex, el, $Terminal, $FitAddon);
}

function destroyTerminal(windowIndex: number) {
  const entry = terminals.get(windowIndex);
  if (!entry) return;
  entry.instance.destroy();
  terminals.delete(windowIndex);
  terminalRefs.delete(windowIndex);
}

// Reset a terminal's connection without destroying the instance.
// Closes the WebSocket and disposes the xterm terminal so that
// connectTerminal() will create a fresh linked tmux session.
function resetTerminal(windowIndex: number) {
  const entry = terminals.get(windowIndex);
  if (!entry?.el) return;
  entry.instance.closeTerminal();
  entry.el = null;
}

async function onRename(windowIndex: number, newName: string) {
  await renameWindow(windowIndex, newName);
}

// Track known window indices to detect externally-created windows
let knownWindowIndices = new Set<number>();
let skipReconnect = false;

// Wrap createWindow to suppress reconnection for UI-initiated creates
async function handleCreate(name?: string) {
  skipReconnect = true;
  await createWindow(name);
  await nextTick();
  skipReconnect = false;
}

// Watch windows list — create/destroy terminal instances as needed
watch(
  windows,
  (newWindows) => {
    const currentIndices = new Set(newWindows.map((w) => w.index));

    // Destroy terminals for removed windows
    for (const index of terminals.keys()) {
      if (!currentIndices.has(index)) {
        destroyTerminal(index);
      }
    }

    // Detect externally-created windows (e.g. ctrl+b+c inside a terminal).
    // When tmux creates a window via keyboard shortcut, the linked session
    // switches to the new window, breaking the old tab's window binding.
    // Reset all connected terminals so they reconnect with correct windows.
    if (!skipReconnect && knownWindowIndices.size > 0) {
      const hasNewExternal = [...currentIndices].some((idx) => !knownWindowIndices.has(idx));
      if (hasNewExternal) {
        for (const [index, entry] of terminals.entries()) {
          if (entry.el && currentIndices.has(index)) {
            resetTerminal(index);
          }
        }
      }
    }
    knownWindowIndices = currentIndices;

    // Ensure terminal instances exist for all windows (but don't connect hidden ones yet)
    for (const w of newWindows) {
      ensureTerminal(w.index);
    }

    // Only connect the active window after DOM update
    nextTick(() => {
      const active = activeWindowIndex.value;
      if (active != null) {
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
watch(activeWindowIndex, (index) => {
  if (index == null) return;
  nextTick(() => {
    const entry = terminals.get(index);
    if (!entry) return;
    if (!entry.el) {
      // Lazily connect terminal when it first becomes visible
      connectTerminal(index);
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
    if (activeWindowIndex.value == null) return;
    const entry = terminals.get(activeWindowIndex.value);
    entry?.instance.fitTerminal(false);
  });
  resizeObserver.observe(terminalsContainer.value);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  for (const index of [...terminals.keys()]) {
    destroyTerminal(index);
  }
  destroyTmuxTabs();
});
</script>

<template>
  <div class="absolute inset-0 flex flex-col" style="background: var(--terminal-bg);">
    <TmuxTabBar
      :windows="windows"
      :active-window-index="activeWindowIndex"
      :default-window-index="defaultWindowIndex"
      @activate="activateWindow"
      @close="closeWindow"
      @create="handleCreate"
      @rename="onRename"
    />

    <div ref="terminalsContainer" class="relative flex-1 min-h-0">
      <div
        v-for="w in windows"
        :key="w.index"
        v-show="w.index === activeWindowIndex"
        :ref="(el) => setTerminalRef(w.index, el)"
        class="absolute inset-0"
      />
    </div>
  </div>
</template>
