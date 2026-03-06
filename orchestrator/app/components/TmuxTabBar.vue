<script setup lang="ts">
import { nanoid } from 'nanoid';
import type { TmuxWindow } from '~/types';

const props = defineProps<{
  windows: TmuxWindow[];
  activeWindowIndex: number | null;
  defaultWindowIndex: number;
}>();

const emit = defineEmits<{
  activate: [index: number];
  close: [index: number];
  create: [name?: string];
  rename: [index: number, newName: string];
}>();

const placeholderName = ref(generatePlaceholder());
const newTabName = ref('');
const editingTab = ref<number | null>(null);
const editingName = ref('');
const editInputRef = ref<HTMLInputElement[]>([]);

function generatePlaceholder(): string {
  return `shell-${nanoid(4)}`;
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function onTabClick(w: TmuxWindow) {
  if (editingTab.value === w.index) return;
  if (w.index === props.activeWindowIndex && w.index !== props.defaultWindowIndex) {
    editingTab.value = w.index;
    editingName.value = w.name;
    nextTick(() => editInputRef.value[0]?.select());
  } else {
    emit('activate', w.index);
  }
}

function commitRename() {
  const index = editingTab.value;
  const newName = sanitizeName(editingName.value.trim());
  editingTab.value = null;

  if (index == null || !newName) return;
  const win = props.windows.find((w) => w.index === index);
  if (!win || newName === win.name) return;

  emit('rename', index, newName);
}

function cancelRename() {
  editingTab.value = null;
}

function onEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitRename();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelRename();
  }
}

function onCreate() {
  let name = newTabName.value.trim() || placeholderName.value;
  if (props.windows.some((w) => w.name === name)) {
    // Fallback to a fresh random name on collision
    name = generatePlaceholder();
  }
  emit('create', name);
  newTabName.value = '';
  placeholderName.value = generatePlaceholder();
}

function onCreateKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    onCreate();
  }
}

function onMiddleClick(event: MouseEvent, w: TmuxWindow) {
  if (event.button !== 1) return;
  event.preventDefault();
  tryClose(w);
}

function tryClose(w: TmuxWindow) {
  if (w.index === props.defaultWindowIndex) return;
  if (!confirm(`Close terminal '${w.name}'? The shell session will be terminated.`)) return;
  emit('close', w.index);
}
</script>

<template>
  <div class="tmux-tab-bar">
    <div class="tmux-tabs-scroll">
      <button
        v-for="w in windows"
        :key="w.index"
        class="tmux-tab"
        :class="{ active: w.index === activeWindowIndex }"
        @click="onTabClick(w)"
        @mousedown="onMiddleClick($event, w)"
      >
        <input
          v-if="editingTab === w.index"
          ref="editInputRef"
          :value="editingName"
          class="tmux-tab-edit"
          @input="editingName = sanitizeName(($event.target as HTMLInputElement).value)"
          @blur="commitRename"
          @keydown="onEditKeydown"
          @click.stop
        />
        <span v-else class="tmux-tab-name">{{ w.name }}</span>
        <span
          v-if="w.index !== defaultWindowIndex && editingTab !== w.index"
          class="tmux-tab-close"
          @click.stop="tryClose(w)"
        >
          &times;
        </span>
      </button>
      <div class="tmux-create-input">
        <input
          :value="newTabName"
          class="tmux-create-field"
          :placeholder="placeholderName"
          @input="newTabName = sanitizeName(($event.target as HTMLInputElement).value)"
          @keydown="onCreateKeydown"
        />
        <button class="tmux-create-btn" @click="onCreate">
          +
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tmux-tab-bar {
  display: flex;
  align-items: center;
  height: 30px;
  min-height: 30px;
  background: var(--terminal-bar-bg);
  border-bottom: 1px solid var(--terminal-bar-border);
  padding: 0 4px;
  gap: 2px;
  user-select: none;
}

.tmux-tabs-scroll {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  flex: 1;
  min-width: 0;
  scrollbar-width: none;
}

.tmux-tabs-scroll::-webkit-scrollbar {
  display: none;
}

.tmux-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  height: 24px;
  border-radius: 4px 4px 0 0;
  font-size: 12px;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
  border: none;
  color: var(--terminal-text-muted);
  background: transparent;
  transition: color 0.15s, background 0.15s;
  position: relative;
}

.tmux-tab:hover {
  color: var(--terminal-text);
  background: var(--terminal-hover-bg);
}

.tmux-tab.active {
  color: var(--terminal-text);
  background: var(--terminal-active-bg);
  border-bottom: 2px solid var(--terminal-active-bg);
  margin-bottom: -1px;
}

.tmux-tab-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tmux-tab-edit {
  width: 80px;
  height: 18px;
  padding: 0 4px;
  font-size: 12px;
  font-family: inherit;
  color: var(--terminal-text);
  background: var(--terminal-bar-bg);
  border: 1px solid var(--terminal-accent);
  border-radius: 3px;
  outline: none;
}

.tmux-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  font-size: 14px;
  line-height: 1;
  color: var(--terminal-text-muted);
  cursor: pointer;
}

.tmux-tab-close:hover {
  background: var(--terminal-close-hover-bg);
  color: var(--terminal-danger);
}

.tmux-create-input {
  display: flex;
  align-items: center;
  height: 22px;
  background: var(--terminal-input-bg);
  border: 1px solid var(--terminal-input-border);
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
  transition: border-color 0.15s;
}

.tmux-create-input:focus-within {
  border-color: var(--terminal-accent);
}

.tmux-create-field {
  width: 72px;
  height: 100%;
  padding: 0 6px;
  font-size: 11px;
  font-family: inherit;
  color: var(--terminal-text-muted);
  background: transparent;
  border: none;
  outline: none;
}

.tmux-create-field:focus {
  color: var(--terminal-text);
}

.tmux-create-field::placeholder {
  color: var(--terminal-text-dimmed);
}

.tmux-create-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 100%;
  font-size: 14px;
  font-family: inherit;
  color: var(--terminal-text-muted);
  background: transparent;
  border: none;
  border-left: 1px solid var(--terminal-input-border);
  cursor: pointer;
  flex-shrink: 0;
}

.tmux-create-btn:hover {
  color: var(--terminal-text);
  background: var(--terminal-hover-bg);
}

</style>
