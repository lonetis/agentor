<script setup lang="ts">
import type { PaneNode, DropZone, DragPayload } from '~/types';
import { isLeaf, isContainer } from '~/composables/useSplitPanes';

const props = defineProps<{
  node: PaneNode;
  focusedNodeId: string | null;
  isRoot?: boolean;
}>();

const emit = defineEmits<{
  activateTab: [tabId: string, nodeId: string];
  closeTab: [tabId: string];
  focusNode: [nodeId: string];
  resize: [firstNodeId: string, deltaFraction: number];
  moveTab: [tabId: string, targetNodeId: string, insertIndex: number | undefined];
  splitWithTab: [tabId: string, direction: 'left' | 'right' | 'top' | 'bottom', refNodeId: string];
}>();

const { isDragging, dragPayload, startDrag, endDrag } = useDragTab();

const containerEl = ref<HTMLElement | null>(null);

function handleSeparatorResize(firstChildId: string, delta: number) {
  if (!containerEl.value) return;
  if (!isContainer(props.node)) return;

  const totalSize = props.node.direction === 'horizontal'
    ? containerEl.value.clientWidth
    : containerEl.value.clientHeight;
  if (totalSize === 0) return;

  const deltaFraction = delta / totalSize;
  emit('resize', firstChildId, deltaFraction);
}

function handleTabDragStart(tabId: string, nodeId: string, event: DragEvent) {
  startDrag(tabId, nodeId, event);
}

function handleTabDragEnd() {
  endDrag();
}

function handlePaneDrop(zone: DropZone, nodeId: string) {
  const payload = dragPayload.value;
  if (!payload) return;

  if (zone === 'center') {
    emit('moveTab', payload.tabId, nodeId, undefined);
  } else {
    emit('splitWithTab', payload.tabId, zone as 'left' | 'right' | 'top' | 'bottom', nodeId);
  }

  endDrag();
}

function handleTabBarDrop(payload: DragPayload, targetNodeId: string, insertIndex: number | undefined) {
  emit('moveTab', payload.tabId, targetNodeId, insertIndex);
  endDrag();
}

// Count total leaves for focus border visibility
function countLeaves(node: PaneNode): number {
  if (isLeaf(node)) return 1;
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0);
}

const totalLeaves = computed(() => {
  if (!props.isRoot) return 2; // Non-root always shows focus border
  return countLeaves(props.node);
});
</script>

<template>
  <!-- Leaf node: tab bar + content + drop overlay -->
  <div
    v-if="isLeaf(node)"
    class="flex flex-col min-w-0 min-h-0"
    :class="totalLeaves > 1 && node.id === focusedNodeId ? 'border-t-2 border-t-blue-500 dark:border-t-[#58a6ff]' : totalLeaves > 1 ? 'border-t-2 border-t-transparent' : ''"
    :style="{ flex: `${node.sizeFraction} 1 0%` }"
    @mousedown="emit('focusNode', node.id)"
    @dragend="handleTabDragEnd"
  >
    <PaneGroupTabBar
      :group="node"
      :is-focused="node.id === focusedNodeId"
      @activate="(tabId) => emit('activateTab', tabId, node.id)"
      @close="(tabId) => emit('closeTab', tabId)"
      @focus-group="emit('focusNode', node.id)"
      @drag-start="handleTabDragStart"
      @drop-on-tab-bar="handleTabBarDrop"
    />
    <div class="flex-1 relative min-h-0">
      <PaneContent
        :group="node"
      />
      <PaneDropOverlay
        v-if="isDragging"
        :node-id="node.id"
        @drop="handlePaneDrop"
      />
    </div>
  </div>

  <!-- Container node: children in flex row/col with separators -->
  <div
    v-else-if="isContainer(node)"
    ref="containerEl"
    class="flex min-w-0 min-h-0"
    :class="node.direction === 'horizontal' ? 'flex-row' : 'flex-col'"
    :style="{ flex: `${node.sizeFraction} 1 0%` }"
    @dragend="handleTabDragEnd"
  >
    <template v-for="(child, i) in node.children" :key="child.id">
      <PaneSplitNode
        :node="child"
        :focused-node-id="focusedNodeId"
        @activate-tab="(tabId, nodeId) => emit('activateTab', tabId, nodeId)"
        @close-tab="(tabId) => emit('closeTab', tabId)"
        @focus-node="(nodeId) => emit('focusNode', nodeId)"
        @resize="(firstId, delta) => emit('resize', firstId, delta)"
        @move-tab="(tabId, targetId, idx) => emit('moveTab', tabId, targetId, idx)"
        @split-with-tab="(tabId, dir, refId) => emit('splitWithTab', tabId, dir, refId)"
      />

      <PaneSeparator
        v-if="i < node.children.length - 1"
        :direction="node.direction"
        @resize="(delta) => handleSeparatorResize(child.id, delta)"
      />
    </template>
  </div>
</template>
