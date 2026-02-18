<script setup lang="ts">
import type { PaneLeafNode, DragPayload } from '~/types';

const props = defineProps<{
  group: PaneLeafNode;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  activate: [tabId: string];
  close: [tabId: string];
  focusGroup: [];
  dragStart: [tabId: string, nodeId: string, event: DragEvent];
  dropOnTabBar: [payload: DragPayload, targetNodeId: string, insertIndex: number | undefined];
}>();

const typeIcons: Record<string, string> = {
  terminal: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  desktop: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  apps: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
  editor: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5',
};

const typeLabels: Record<string, string> = {
  terminal: 'Terminal',
  desktop: 'Desktop',
  apps: 'Apps',
  editor: 'Editor',
};

const dropInsertIndex = ref<number | null>(null);
const tabBarEl = ref<HTMLElement | null>(null);

function onMiddleClick(e: MouseEvent, tabId: string) {
  if (e.button === 1) {
    e.preventDefault();
    emit('close', tabId);
  }
}

function onTabDragStart(tabId: string, event: DragEvent) {
  emit('dragStart', tabId, props.group.id, event);
}

function onTabBarDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }

  // Calculate insert index from cursor position relative to tab elements
  if (!tabBarEl.value) return;
  const tabs = tabBarEl.value.querySelectorAll('.tab-item');
  let idx = props.group.tabs.length;
  for (let i = 0; i < tabs.length; i++) {
    const rect = tabs[i]!.getBoundingClientRect();
    if (event.clientX < rect.left + rect.width / 2) {
      idx = i;
      break;
    }
  }
  dropInsertIndex.value = idx;
}

function onTabBarDragLeave(event: DragEvent) {
  const related = event.relatedTarget as HTMLElement | null;
  if (!tabBarEl.value?.contains(related)) {
    dropInsertIndex.value = null;
  }
}

function onTabBarDrop(event: DragEvent) {
  event.preventDefault();
  try {
    const raw = event.dataTransfer?.getData('application/x-agentor-tab');
    if (!raw) return;
    const payload = JSON.parse(raw) as DragPayload;
    emit('dropOnTabBar', payload, props.group.id, dropInsertIndex.value ?? undefined);
  } catch {
    // ignore
  }
  dropInsertIndex.value = null;
}

// Calculate the left position of the insert indicator
const insertIndicatorLeft = computed(() => {
  if (dropInsertIndex.value === null || !tabBarEl.value) return 0;
  const tabs = tabBarEl.value.querySelectorAll('.tab-item');
  if (tabs.length === 0) return 0;
  if (dropInsertIndex.value >= tabs.length) {
    const last = tabs[tabs.length - 1]!.getBoundingClientRect();
    const barRect = tabBarEl.value.getBoundingClientRect();
    return last.right - barRect.left;
  }
  const target = tabs[dropInsertIndex.value]!.getBoundingClientRect();
  const barRect = tabBarEl.value.getBoundingClientRect();
  return target.left - barRect.left;
});
</script>

<template>
  <div
    ref="tabBarEl"
    class="pane-tab-bar flex items-end border-b overflow-x-auto relative"
    style="background: var(--pane-tab-bg); border-color: var(--pane-tab-border);"
    @mousedown="emit('focusGroup')"
    @dragover="onTabBarDragOver"
    @dragleave="onTabBarDragLeave"
    @drop="onTabBarDrop"
  >
    <div
      v-for="tab in group.tabs"
      :key="tab.id"
      class="tab-item flex items-center gap-1.5 px-3 h-[36px] text-xs cursor-pointer select-none group shrink-0 border-b-2"
      :style="{ borderRightColor: 'var(--pane-tab-border)' }"
      :class="tab.id === group.activeTabId
        ? 'pane-tab-active border-r'
        : 'pane-tab-inactive border-r border-b-transparent'"
      draggable="true"
      @dragstart="onTabDragStart(tab.id, $event)"
      @click="emit('activate', tab.id)"
      @mousedown="onMiddleClick($event, tab.id)"
    >
      <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="typeIcons[tab.type]" />
      </svg>
      <span class="truncate max-w-[140px]">{{ tab.containerName }} - {{ typeLabels[tab.type] }}</span>
      <button
        class="ml-1 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pane-tab-close"
        :class="tab.id === group.activeTabId ? 'opacity-60' : ''"
        @click.stop="emit('close', tab.id)"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Drop insert indicator -->
    <div
      v-if="dropInsertIndex !== null"
      class="absolute top-0 bottom-0 w-0.5 bg-blue-500 z-10 pointer-events-none"
      :style="{ left: insertIndicatorLeft + 'px' }"
    />
  </div>
</template>

<style scoped>
.pane-tab-bar {
  scrollbar-width: none;
}
.pane-tab-bar::-webkit-scrollbar {
  display: none;
}
.pane-tab-active {
  background: var(--pane-tab-active-bg);
  color: var(--pane-tab-active-text);
  border-bottom-color: var(--pane-tab-active-accent);
}
.pane-tab-inactive {
  background: var(--pane-tab-bg);
  color: var(--pane-tab-inactive-text);
}
.pane-tab-inactive:hover {
  color: var(--pane-tab-hover-text);
  background: var(--pane-tab-hover-bg);
}
.pane-tab-close:hover {
  background: var(--pane-tab-close-hover-bg);
}
</style>
