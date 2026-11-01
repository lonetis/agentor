<script setup lang="ts">
import type { ContextMenuItem } from '@nuxt/ui';
import type { TerminalClasses } from '~/composables/useTerminal';
import type { SpecialKey } from '~/utils/terminal-keys';

const props = defineProps<{
  containerId: string;
}>();

const { $Terminal, $FitAddon, $WebLinksAddon } = useNuxtApp();
const terminalClasses = { Terminal: $Terminal, FitAddon: $FitAddon, WebLinksAddon: $WebLinksAddon } as TerminalClasses;

const toast = useToast();
const prefs = useTerminalPrefs();
const { isTouch, isMac } = useDevice();

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

type TerminalInstance = ReturnType<typeof useTerminal>;

// Map of window index -> terminal instance + element ref
const terminals = new Map<number, { instance: TerminalInstance; el: HTMLElement | null }>();

// The active window's terminal, for the toolbar / overlays (the map itself is
// not reactive).
const active = shallowRef<TerminalInstance | null>(null);
function syncActive() {
  const index = activeWindowIndex.value;
  active.value = index == null ? null : terminals.get(index)?.instance ?? null;
}

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

// Plain-text view of the active window (scrollback, native selection)
const textViewOpen = ref(false);

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
  entry.instance.openTerminal(props.containerId, windowIndex, el, terminalClasses);
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
    syncActive();

    // Only connect the active window after DOM update
    nextTick(() => {
      const index = activeWindowIndex.value;
      if (index != null) {
        const entry = terminals.get(index);
        if (entry && !entry.el) {
          connectTerminal(index);
        }
      }
    });
  },
  { deep: true },
);

// When active tab changes: connect if needed, then refit
watch(activeWindowIndex, (index) => {
  syncActive();
  textViewOpen.value = false;
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

// ResizeObserver for all resize scenarios (window, sidebar, split panes, the
// soft keyboard via the app shell, toolbar / composer toggling)
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  if (!terminalsContainer.value) return;
  resizeObserver = new ResizeObserver(() => {
    active.value?.fitTerminal(false);
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

// --- Active terminal state for the template --------------------------------

const status = computed(() => active.value?.status.value ?? 'connecting');
const hasSelection = computed(() => active.value?.hasSelection.value ?? false);
const touchSelection = computed(() => active.value?.touchSelection.value ?? false);
const keyboardOpen = computed(() => active.value?.isFocused.value ?? false);
const modifiers = computed(() => active.value?.modifiers ?? { ctrl: false, alt: false });

// --- Clipboard ---------------------------------------------------------------

async function copySelection() {
  const ok = await active.value?.copySelection();
  toast.add(ok
    ? { title: 'Copied to clipboard', color: 'success', icon: 'i-lucide-check' }
    : { title: 'Copy failed', description: 'The browser blocked clipboard access.', color: 'error', icon: 'i-lucide-alert-circle' });
}

const composerOpen = ref(false);
const composerHint = ref<string | null>(null);

function openComposer(hint: string | null = null) {
  composerHint.value = hint;
  composerOpen.value = true;
}

async function paste() {
  const ok = await active.value?.pasteFromClipboard();
  if (!ok) {
    // No async clipboard (plain http, Firefox) or permission denied: a native
    // text field still supports the system paste menu.
    openComposer('Clipboard access is unavailable here — long-press the field and choose Paste, then Insert or Send.');
  }
}

function onComposerSend(text: string, submit: boolean) {
  active.value?.pasteText(text, submit);
}

function closeComposer() {
  composerOpen.value = false;
  composerHint.value = null;
}

// --- Text view (scrollback, native selection) ------------------------------

function closeTextView() {
  textViewOpen.value = false;
  if (!isTouch.value) active.value?.focus();
}

// --- Toolbar -----------------------------------------------------------------

function toggleKeyboard() {
  if (keyboardOpen.value) active.value?.blur();
  else active.value?.focus();
}

function onKey(key: SpecialKey) {
  active.value?.sendKey(key);
}

// --- Desktop context menu ----------------------------------------------------

const copyKbds = computed(() => (isMac.value ? ['meta', 'c'] : ['ctrl', 'shift', 'c']));
const pasteKbds = computed(() => (isMac.value ? ['meta', 'v'] : ['ctrl', 'shift', 'v']));

const contextItems = computed<ContextMenuItem[][]>(() => [
  [
    { label: 'Copy', icon: 'i-lucide-copy', kbds: copyKbds.value, disabled: !hasSelection.value, onSelect: () => { void copySelection(); } },
    { label: 'Paste', icon: 'i-lucide-clipboard-paste', kbds: pasteKbds.value, onSelect: () => { void paste(); } },
    { label: 'Select all', icon: 'i-lucide-square-dashed-text', onSelect: () => active.value?.selectAll() },
  ],
  [
    { label: 'Open text view', icon: 'i-lucide-scroll-text', onSelect: () => { textViewOpen.value = true; } },
    { label: 'Compose text', icon: 'i-lucide-square-pen', onSelect: () => openComposer() },
  ],
  [
    { label: 'Larger font', icon: 'i-lucide-a-arrow-up', onSelect: () => prefs.adjustFontSize(1) },
    { label: 'Smaller font', icon: 'i-lucide-a-arrow-down', onSelect: () => prefs.adjustFontSize(-1) },
    { label: 'Reset font size', icon: 'i-lucide-rotate-ccw', onSelect: () => prefs.resetFontSize() },
  ],
  [
    {
      label: prefs.toolbarVisible.value ? 'Hide touch keys' : 'Show touch keys',
      icon: 'i-lucide-keyboard',
      onSelect: () => prefs.toggleToolbar(),
    },
  ],
]);
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
    >
      <template #actions>
        <button
          type="button"
          class="term-bar-btn"
          :class="{ 'term-bar-btn-active': prefs.toolbarVisible.value }"
          :aria-label="prefs.toolbarVisible.value ? 'Hide touch keys' : 'Show touch keys'"
          :aria-pressed="prefs.toolbarVisible.value"
          :title="prefs.toolbarVisible.value ? 'Hide touch keys' : 'Show touch keys'"
          @click="prefs.toggleToolbar()"
        >
          <UIcon name="i-lucide-keyboard" class="size-3.5" />
        </button>
      </template>
    </TmuxTabBar>

    <UContextMenu :items="contextItems" :disabled="isTouch">
      <div ref="terminalsContainer" class="relative flex-1 min-h-0">
        <div
          v-for="w in windows"
          :key="w.index"
          v-show="w.index === activeWindowIndex"
          :ref="(el) => setTerminalRef(w.index, el)"
          class="terminal-surface absolute inset-0"
        />

        <!-- Connection lost: reconnects automatically, or on demand -->
        <div
          v-if="status === 'disconnected'"
          class="term-overlay term-overlay-top"
          role="status"
          data-testid="terminal-disconnected"
        >
          <UIcon name="i-lucide-unplug" class="size-3.5 shrink-0" />
          <span>Disconnected — reconnecting…</span>
          <button type="button" class="term-overlay-btn" @click="active?.reconnect()">Reconnect now</button>
        </div>

        <!-- Actions for a touch (long-press) selection -->
        <div
          v-if="touchSelection && hasSelection"
          class="term-overlay term-overlay-bottom"
          data-testid="terminal-selection-actions"
        >
          <button type="button" class="term-overlay-btn term-overlay-btn-primary" @mousedown.prevent @click="copySelection">
            <UIcon name="i-lucide-copy" class="size-3.5" /> Copy
          </button>
          <button type="button" class="term-overlay-btn" @mousedown.prevent @click="active?.selectAll()">Select all</button>
          <button type="button" class="term-overlay-btn" @mousedown.prevent @click="textViewOpen = true">More…</button>
          <button
            type="button"
            class="term-overlay-btn"
            aria-label="Clear selection"
            @mousedown.prevent
            @click="active?.clearSelection()"
          >
            <UIcon name="i-lucide-x" class="size-3.5" />
          </button>
        </div>

        <TerminalTextView
          v-if="textViewOpen && activeWindowIndex != null"
          :container-id="containerId"
          :window-index="activeWindowIndex"
          :font-size="prefs.fontSize.value"
          :fallback-text="() => active?.getVisibleText() ?? ''"
          @close="closeTextView"
        />
      </div>
    </UContextMenu>

    <TerminalComposer
      v-if="composerOpen"
      :hint="composerHint"
      @send="onComposerSend"
      @close="closeComposer"
    />

    <TerminalToolbar
      v-if="prefs.toolbarVisible.value"
      :keyboard-open="keyboardOpen"
      :ctrl="modifiers.ctrl"
      :alt="modifiers.alt"
      @key="onKey"
      @raw="(data) => active?.sendText(data)"
      @text="(text) => active?.sendText(text)"
      @modifier="(name) => active?.toggleModifier(name)"
      @toggle-keyboard="toggleKeyboard"
      @compose="composerOpen ? closeComposer() : openComposer()"
      @paste="paste"
      @select-text="textViewOpen = !textViewOpen"
      @font-size="(delta) => prefs.adjustFontSize(delta)"
    />
  </div>
</template>

<style scoped>
.term-bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--terminal-text-muted);
  cursor: pointer;
}

.term-bar-btn:hover {
  color: var(--terminal-text);
  background: var(--terminal-hover-bg);
}

.term-bar-btn:focus-visible {
  outline: 2px solid var(--terminal-accent);
  outline-offset: -2px;
}

.term-bar-btn-active {
  color: var(--terminal-accent);
}

.term-overlay {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 16px);
  padding: 4px 4px 4px 10px;
  border-radius: 9999px;
  border: 1px solid var(--terminal-bar-border);
  background: var(--terminal-bar-bg);
  color: var(--terminal-text);
  font-size: 12px;
  white-space: nowrap;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}

.term-overlay-top {
  top: 8px;
}

.term-overlay-bottom {
  bottom: 10px;
  padding-left: 4px;
}

.term-overlay-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  border-radius: 9999px;
  border: 1px solid var(--terminal-input-border);
  background: var(--terminal-input-bg);
  color: var(--terminal-text);
  font-size: 12px;
  cursor: pointer;
  touch-action: manipulation;
}

.term-overlay-btn:hover {
  background: var(--terminal-hover-bg);
}

.term-overlay-btn-primary {
  background: var(--terminal-accent);
  border-color: var(--terminal-accent);
  color: #fff;
}

.term-overlay-btn-primary:hover {
  background: var(--terminal-accent);
  filter: brightness(1.1);
}
</style>
