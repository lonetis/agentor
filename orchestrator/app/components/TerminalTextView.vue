<script setup lang="ts">
import { copyText } from '~/utils/clipboard';

// The terminal's text (including tmux scrollback) as a plain, natively
// selectable element: system selection handles, magnifier and the OS copy
// menu work here, which xterm.js's canvas-like screen cannot offer on touch.

const props = defineProps<{
  containerId: string;
  windowIndex: number;
  fontSize: number;
  /** Visible screen from the terminal, used when the history cannot be fetched. */
  fallbackText: () => string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const HISTORY_LINES = 3000;

const toast = useToast();
const content = ref('');
const loading = ref(true);
const notice = ref<string | null>(null);
const pre = ref<HTMLElement | null>(null);

async function load() {
  loading.value = true;
  notice.value = null;
  try {
    const res = await $fetch<{ content: string }>(
      `/api/containers/${props.containerId}/panes/${props.windowIndex}/capture`,
      { query: { history: HISTORY_LINES } },
    );
    content.value = res.content;
  } catch (err) {
    console.error('[terminal-text-view] capture failed', err);
    content.value = props.fallbackText();
    notice.value = 'Scrollback is unavailable — showing the visible screen only.';
  } finally {
    loading.value = false;
    await nextTick();
    if (pre.value) pre.value.scrollTop = pre.value.scrollHeight;
  }
}

function selectedText(): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !pre.value) return '';
  return pre.value.contains(sel.anchorNode) ? sel.toString() : '';
}

async function copy() {
  const selection = selectedText();
  const ok = await copyText(selection || content.value);
  toast.add({
    title: ok ? (selection ? 'Selection copied' : 'All text copied') : 'Copy failed',
    color: ok ? 'success' : 'error',
    icon: ok ? 'i-lucide-check' : 'i-lucide-alert-circle',
  });
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}

onMounted(load);
</script>

<template>
  <div
    class="term-text-view"
    role="dialog"
    aria-label="Terminal text"
    data-testid="terminal-text-view"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <div class="term-text-view-header">
      <div class="term-text-view-title">
        <UIcon name="i-lucide-square-dashed-text" class="size-4 shrink-0" />
        <span class="truncate">Select text</span>
        <span class="term-text-view-sub">long-press or drag to select</span>
      </div>
      <button type="button" class="term-text-view-btn" aria-label="Reload text" title="Reload" @click="load">
        <UIcon name="i-lucide-refresh-cw" class="size-4" :class="{ 'animate-spin': loading }" />
      </button>
      <button type="button" class="term-text-view-btn" aria-label="Copy text" title="Copy selection (or everything)" @click="copy">
        <UIcon name="i-lucide-copy" class="size-4" />
      </button>
      <button type="button" class="term-text-view-btn" aria-label="Close text view" title="Close" @click="emit('close')">
        <UIcon name="i-lucide-x" class="size-4" />
      </button>
    </div>
    <p v-if="notice" class="term-text-view-notice">{{ notice }}</p>
    <pre
      ref="pre"
      class="term-text-view-content"
      :style="{ fontSize: `${fontSize}px` }"
    >{{ loading && !content ? 'Loading…' : content }}</pre>
  </div>
</template>

<style scoped>
.term-text-view {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  background: var(--terminal-bg);
  color: var(--terminal-text);
  outline: none;
}

.term-text-view-header {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 40px;
  padding: 0 6px 0 10px;
  background: var(--terminal-bar-bg);
  border-bottom: 1px solid var(--terminal-bar-border);
}

.term-text-view-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
}

.term-text-view-sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--terminal-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.term-text-view-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--terminal-text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.term-text-view-btn:hover {
  background: var(--terminal-hover-bg);
  color: var(--terminal-text);
}

.term-text-view-btn:focus-visible {
  outline: 2px solid var(--terminal-accent);
  outline-offset: -2px;
}

.term-text-view-notice {
  margin: 0;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--terminal-text-muted);
  border-bottom: 1px solid var(--terminal-bar-border);
}

.term-text-view-content {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: Menlo, "SF Mono", ui-monospace, "Cascadia Code", "Fira Code", "JetBrains Mono", "Roboto Mono", monospace;
  line-height: 1.25;
  user-select: text;
  -webkit-user-select: text;
  -webkit-touch-callout: default;
  cursor: text;
}
</style>
