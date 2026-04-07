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
  terminal: 'i-lucide-terminal',
  desktop: 'i-lucide-monitor',
  apps: 'i-lucide-layout-grid',
  editor: 'i-lucide-code',
  vscode: 'i-lucide-radio-tower',
  logs: 'i-lucide-scroll-text',
};

const typeLabels: Record<string, string> = {
  terminal: 'Terminal',
  desktop: 'Desktop',
  apps: 'Apps',
  editor: 'Editor',
  vscode: 'VS Code Tunnel',
  logs: 'Logs',
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
      <UIcon :name="typeIcons[tab.type]!" class="size-3.5 shrink-0" />
      <span class="truncate max-w-[140px]">{{ tab.type === 'logs' ? 'Logs' : `${tab.containerName} - ${typeLabels[tab.type]}` }}</span>
      <button
        class="ml-1 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pane-tab-close"
        :class="tab.id === group.activeTabId ? 'opacity-60' : ''"
        @click.stop="emit('close', tab.id)"
      >
        <UIcon name="i-lucide-x" class="size-3" />
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
