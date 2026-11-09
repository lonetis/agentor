<script setup lang="ts">
import type { PaneNode, DropZone, DragPayload } from '~/types';
import { isLeaf, isContainer } from '~/composables/useSplitPanes';

const props = defineProps<{
  node: PaneNode;
  focusedNodeId: string | null;
  isRoot?: boolean;
  /** Top-left-most node under its parent (where the expand-sidebar button floats). */
  atLeadingEdge?: boolean;
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
const paneContent = ref<{ focusTerminal: () => void; cancelFocus: () => void } | null>(null);

function handleActivateTab(tabId: string, focusContent: boolean) {
  emit('activateTab', tabId, props.node.id);
  // After the tab is shown (and mounted, on its first activation).
  nextTick(() => {
    if (focusContent) paneContent.value?.focusTerminal();
    else paneContent.value?.cancelFocus();
  });
}

const isLeadingEdge = computed(() => !!props.isRoot || !!props.atLeadingEdge);

// Measured once per separator drag: reading clientWidth on every move forces a
// layout per pointermove.
let dragTotalSize = 0;

function measureTotalSize(): number {
  if (!containerEl.value || !isContainer(props.node)) return 0;
  return props.node.direction === 'horizontal'
    ? containerEl.value.clientWidth
    : containerEl.value.clientHeight;
}

/** Position of the separator after child `index`, in percent (for assistive tech). */
function separatorPosition(index: number): number | undefined {
  if (!isContainer(props.node)) return undefined;
  const sizes = props.node.children.map((c) => c.sizeFraction);
  const total = sizes.reduce((sum, s) => sum + s, 0);
  if (!total) return undefined;
  const before = sizes.slice(0, index + 1).reduce((sum, s) => sum + s, 0);
  return Math.round((100 * before) / total);
}

function handleSeparatorResizeStart() {
  dragTotalSize = measureTotalSize();
}

function handleSeparatorResize(firstChildId: string, delta: number) {
  if (!dragTotalSize) dragTotalSize = measureTotalSize();
  if (!dragTotalSize) return;
  emit('resize', firstChildId, delta / dragTotalSize);
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

const showsFocusBorder = computed(() => totalLeaves.value > 1 && props.node.id === props.focusedNodeId);
</script>

<template>
  <!-- Leaf node: tab bar + content + drop overlay -->
  <div
    v-if="isLeaf(node)"
    class="flex flex-col min-w-0 min-h-0"
    :class="showsFocusBorder ? 'border-t-2' : totalLeaves > 1 ? 'border-t-2 border-t-transparent' : ''"
    :style="{
      flex: `${node.sizeFraction} 1 0%`,
      borderTopColor: showsFocusBorder ? 'var(--pane-tab-active-accent)' : undefined,
    }"
    @pointerdown.capture="emit('focusNode', node.id)"
    @dragend="handleTabDragEnd"
  >
    <PaneGroupTabBar
      :group="node"
      :is-focused="node.id === focusedNodeId"
      :leading-inset="isLeadingEdge"
      @activate="handleActivateTab"
      @close="(tabId) => emit('closeTab', tabId)"
      @focus-group="emit('focusNode', node.id)"
      @drag-start="handleTabDragStart"
      @drop-on-tab-bar="handleTabBarDrop"
    />
    <div class="flex-1 relative min-h-0">
      <PaneContent
        ref="paneContent"
        :group="node"
        :is-focused="node.id === focusedNodeId"
        @focus-group="emit('focusNode', node.id)"
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
        :at-leading-edge="isLeadingEdge && i === 0"
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
        :position="separatorPosition(i)"
        @resize-start="handleSeparatorResizeStart"
        @resize="(delta) => handleSeparatorResize(child.id, delta)"
      />
    </template>
  </div>
</template>
