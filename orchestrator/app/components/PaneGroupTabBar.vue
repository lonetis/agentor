<script setup lang="ts">
import type { PaneLeafNode, DragPayload, Tab } from '~/types';

const props = defineProps<{
  group: PaneLeafNode;
  isFocused: boolean;
  /** This bar sits at the top-left of the panes, where the expand-sidebar button floats. */
  leadingInset?: boolean;
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
  logs: 'i-lucide-scroll-text',
};

const typeLabels: Record<string, string> = {
  terminal: 'Terminal',
  desktop: 'Desktop',
  apps: 'Apps',
  editor: 'Editor',
  logs: 'Logs',
};

const dropInsertIndex = ref<number | null>(null);
const tabBarEl = ref<HTMLElement | null>(null);

function tabLabel(tab: Tab): string {
  return tab.type === 'logs' ? 'Logs' : `${tab.containerName} - ${typeLabels[tab.type] ?? tab.type}`;
}

const tabLabels = computed(() => props.group.tabs.map(tabLabel));

function tabElements(): HTMLElement[] {
  return Array.from(tabBarEl.value?.querySelectorAll<HTMLElement>('.tab-item') ?? []);
}

function focusActiveTab() {
  nextTick(() => {
    const index = props.group.tabs.findIndex((t) => t.id === props.group.activeTabId);
    if (index >= 0) tabElements()[index]?.focus();
  });
}

// Keyboard model of the WAI-ARIA tabs pattern (automatic activation).
function onTabKeydown(e: KeyboardEvent, index: number) {
  // Ignore keys bubbling up from the close button.
  if (e.target !== e.currentTarget) return;
  const tabs = props.group.tabs;
  const tab = tabs[index];
  if (!tab) return;

  let next: number | null = null;
  switch (e.key) {
    case 'Enter':
    case ' ':
      e.preventDefault();
      emit('activate', tab.id);
      return;
    case 'Delete':
      e.preventDefault();
      emit('close', tab.id);
      focusActiveTab();
      return;
    case 'ArrowLeft':
      next = (index - 1 + tabs.length) % tabs.length;
      break;
    case 'ArrowRight':
      next = (index + 1) % tabs.length;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = tabs.length - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  emit('activate', tabs[next]!.id);
  tabElements()[next]?.focus();
}

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
    :style="leadingInset ? { paddingLeft: 'var(--pane-leading-inset, 0px)' } : undefined"
    role="tablist"
    aria-label="Open panes"
    @pointerdown="emit('focusGroup')"
    @dragover="onTabBarDragOver"
    @dragleave="onTabBarDragLeave"
    @drop="onTabBarDrop"
  >
    <div
      v-for="(tab, index) in group.tabs"
      :key="tab.id"
      class="tab-item flex items-center gap-1.5 px-3 pointer-coarse:pr-1 h-[36px] text-xs cursor-pointer select-none group shrink-0 border-b-2"
      :style="{ borderRightColor: 'var(--pane-tab-border)' }"
      :class="tab.id === group.activeTabId
        ? 'pane-tab-active border-r'
        : 'pane-tab-inactive border-r border-b-transparent'"
      role="tab"
      :aria-label="tabLabels[index]"
      aria-keyshortcuts="Delete"
      :aria-selected="tab.id === group.activeTabId"
      :tabindex="tab.id === group.activeTabId ? 0 : -1"
      :title="tabLabels[index]"
      draggable="true"
      @dragstart="onTabDragStart(tab.id, $event)"
      @click="emit('activate', tab.id)"
      @keydown="onTabKeydown($event, index)"
      @mousedown.middle.prevent
      @auxclick="onMiddleClick($event, tab.id)"
    >
      <UIcon :name="typeIcons[tab.type] ?? 'i-lucide-file'" class="size-3.5 shrink-0" />
      <span class="truncate max-w-[140px] sm:max-w-[180px]">{{ tabLabels[index] }}</span>
      <!-- On touch only the active tab's close button shows and takes taps, so a
           tap on an inactive tab always activates it instead of closing it. -->
      <button
        type="button"
        tabindex="-1"
        :aria-label="`Close ${tabLabels[index]}`"
        title="Close tab"
        class="pane-tab-close ml-1 size-4 flex items-center justify-center rounded transition-opacity shrink-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
        :class="tab.id === group.activeTabId
          ? 'opacity-60 pointer-coarse:opacity-100 pointer-coarse:size-7'
          : 'opacity-0 pointer-coarse:opacity-0 pointer-coarse:pointer-events-none'"
        @click.stop="emit('close', tab.id)"
      >
        <UIcon name="i-lucide-x" class="size-3 pointer-coarse:size-4" />
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
