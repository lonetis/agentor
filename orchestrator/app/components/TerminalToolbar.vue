<script setup lang="ts">
import type { SpecialKey } from '~/utils/terminal-keys';

// Extra keys for touch devices (the soft keyboard has no Esc, Tab, Ctrl,
// arrows, …). Buttons never take focus (mousedown is prevented) so tapping a
// key does not close the soft keyboard.

defineProps<{
  keyboardOpen: boolean;
  ctrl: boolean;
  alt: boolean;
}>();

const emit = defineEmits<{
  key: [key: SpecialKey];
  raw: [data: string];
  text: [text: string];
  modifier: [name: 'ctrl' | 'alt'];
  toggleKeyboard: [];
  compose: [];
  paste: [];
  selectText: [];
  fontSize: [delta: number];
}>();

type ToolbarItem =
  | { kind: 'key'; key: SpecialKey; label?: string; icon?: string; title: string; repeat?: boolean }
  | { kind: 'mod'; mod: 'ctrl' | 'alt'; label: string; title: string }
  | { kind: 'raw'; data: string; label: string; title: string }
  | { kind: 'text'; text: string; title: string }
  | { kind: 'font'; delta: number; icon: string; title: string };

const ITEMS: ToolbarItem[] = [
  { kind: 'key', key: 'escape', label: 'Esc', title: 'Escape' },
  { kind: 'key', key: 'tab', label: 'Tab', title: 'Tab' },
  { kind: 'mod', mod: 'ctrl', label: 'Ctrl', title: 'Ctrl — applies to the next key' },
  { kind: 'mod', mod: 'alt', label: 'Alt', title: 'Alt — applies to the next key' },
  { kind: 'key', key: 'up', icon: 'i-lucide-arrow-up', title: 'Up', repeat: true },
  { kind: 'key', key: 'down', icon: 'i-lucide-arrow-down', title: 'Down', repeat: true },
  { kind: 'key', key: 'left', icon: 'i-lucide-arrow-left', title: 'Left', repeat: true },
  { kind: 'key', key: 'right', icon: 'i-lucide-arrow-right', title: 'Right', repeat: true },
  { kind: 'key', key: 'shift-enter', label: '⇧↵', title: 'New line (Shift+Enter)' },
  { kind: 'raw', data: '\x03', label: '^C', title: 'Interrupt (Ctrl+C)' },
  { kind: 'key', key: 'home', label: 'Home', title: 'Home' },
  { kind: 'key', key: 'end', label: 'End', title: 'End' },
  { kind: 'key', key: 'page-up', label: 'PgUp', title: 'Page up', repeat: true },
  { kind: 'key', key: 'page-down', label: 'PgDn', title: 'Page down', repeat: true },
  { kind: 'text', text: '/', title: 'Slash' },
  { kind: 'text', text: '-', title: 'Hyphen' },
  { kind: 'text', text: '|', title: 'Pipe' },
  { kind: 'text', text: '~', title: 'Tilde' },
  { kind: 'text', text: '_', title: 'Underscore' },
  { kind: 'font', delta: -1, icon: 'i-lucide-a-arrow-down', title: 'Smaller font' },
  { kind: 'font', delta: 1, icon: 'i-lucide-a-arrow-up', title: 'Larger font' },
];

const HOLD_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 70;

let holdTimer: ReturnType<typeof setTimeout> | null = null;
let repeatTimer: ReturnType<typeof setInterval> | null = null;
// A held key already fired; swallow the click that ends the hold.
let suppressClick = false;

function fire(item: ToolbarItem) {
  switch (item.kind) {
    case 'key': emit('key', item.key); break;
    case 'mod': emit('modifier', item.mod); break;
    case 'raw': emit('raw', item.data); break;
    case 'text': emit('text', item.text); break;
    case 'font': emit('fontSize', item.delta); break;
  }
}

function stopRepeat() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
}

function onPointerDown(item: ToolbarItem) {
  stopRepeat();
  suppressClick = false;
  if (item.kind !== 'key' || !item.repeat) return;
  holdTimer = setTimeout(() => {
    holdTimer = null;
    suppressClick = true;
    fire(item);
    repeatTimer = setInterval(() => fire(item), REPEAT_INTERVAL_MS);
  }, HOLD_DELAY_MS);
}

function onClick(item: ToolbarItem) {
  stopRepeat();
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  fire(item);
}

function isActive(item: ToolbarItem, ctrl: boolean, alt: boolean) {
  return item.kind === 'mod' && (item.mod === 'ctrl' ? ctrl : alt);
}

function itemLabel(item: ToolbarItem) {
  if (item.kind === 'text') return item.text;
  if (item.kind === 'font') return '';
  return 'label' in item ? item.label ?? '' : '';
}

onUnmounted(stopRepeat);
</script>

<template>
  <div class="term-toolbar" role="toolbar" aria-label="Terminal keys" data-testid="terminal-toolbar">
    <button
      type="button"
      class="term-key term-key-icon"
      :class="{ 'term-key-active': keyboardOpen }"
      :aria-label="keyboardOpen ? 'Hide keyboard' : 'Show keyboard'"
      :title="keyboardOpen ? 'Hide keyboard' : 'Show keyboard'"
      @mousedown.prevent
      @click="emit('toggleKeyboard')"
    >
      <UIcon :name="keyboardOpen ? 'i-lucide-keyboard-off' : 'i-lucide-keyboard'" class="size-4" />
    </button>

    <div class="term-toolbar-scroll">
      <button
        v-for="(item, i) in ITEMS"
        :key="i"
        type="button"
        class="term-key"
        :class="{ 'term-key-active': isActive(item, ctrl, alt), 'term-key-icon': !!('icon' in item && item.icon) }"
        :aria-label="item.title"
        :aria-pressed="item.kind === 'mod' ? isActive(item, ctrl, alt) : undefined"
        :title="item.title"
        :data-key="item.kind === 'key' ? item.key : item.kind === 'mod' ? item.mod : undefined"
        @mousedown.prevent
        @pointerdown="onPointerDown(item)"
        @pointerup="stopRepeat"
        @pointerleave="stopRepeat"
        @pointercancel="stopRepeat"
        @contextmenu.prevent
        @click="onClick(item)"
      >
        <UIcon v-if="'icon' in item && item.icon" :name="item.icon" class="size-4" />
        <template v-else>{{ itemLabel(item) }}</template>
      </button>
    </div>

    <div class="term-toolbar-actions">
      <button
        type="button"
        class="term-key term-key-icon"
        aria-label="Compose text"
        title="Compose text (autocorrect, dictation)"
        @mousedown.prevent
        @click="emit('compose')"
      >
        <UIcon name="i-lucide-square-pen" class="size-4" />
      </button>
      <button
        type="button"
        class="term-key term-key-icon"
        aria-label="Paste"
        title="Paste from clipboard"
        @mousedown.prevent
        @click="emit('paste')"
      >
        <UIcon name="i-lucide-clipboard-paste" class="size-4" />
      </button>
      <button
        type="button"
        class="term-key term-key-icon"
        aria-label="Select text"
        title="Select and copy text (with scrollback)"
        @mousedown.prevent
        @click="emit('selectText')"
      >
        <UIcon name="i-lucide-square-dashed-text" class="size-4" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.term-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 44px;
  min-height: 44px;
  padding: 0 4px;
  background: var(--terminal-bar-bg);
  border-top: 1px solid var(--terminal-bar-border);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}

.term-toolbar-scroll {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  touch-action: pan-x;
}

.term-toolbar-scroll::-webkit-scrollbar {
  display: none;
}

.term-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 4px;
  border-left: 1px solid var(--terminal-bar-border);
}

.term-key {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 34px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--terminal-input-border);
  background: var(--terminal-input-bg);
  color: var(--terminal-text);
  font-family: Menlo, ui-monospace, monospace;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}

.term-key-icon {
  padding: 0;
  width: 40px;
}

.term-key:active {
  background: var(--terminal-hover-bg);
}

@media (hover: hover) {
  .term-key:hover {
    background: var(--terminal-hover-bg);
  }
}

.term-key:focus-visible {
  outline: 2px solid var(--terminal-accent);
  outline-offset: 1px;
}

.term-key-active {
  border-color: var(--terminal-accent);
  color: var(--terminal-accent);
  background: color-mix(in srgb, var(--terminal-accent) 14%, var(--terminal-input-bg));
}
</style>
