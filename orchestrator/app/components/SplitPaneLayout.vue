<script setup lang="ts">
import type { PaneNode } from '~/types';

defineProps<{
  rootNode: PaneNode | null;
  focusedNodeId: string | null;
}>();

const emit = defineEmits<{
  activateTab: [tabId: string, nodeId: string];
  closeTab: [tabId: string];
  focusNode: [nodeId: string];
  resize: [firstNodeId: string, deltaFraction: number];
  moveTab: [tabId: string, targetNodeId: string, insertIndex: number | undefined];
  splitWithTab: [tabId: string, direction: 'left' | 'right' | 'top' | 'bottom', referenceNodeId: string];
}>();
</script>

<template>
  <div class="flex flex-1 min-w-0 min-h-0">
    <PaneSplitNode
      v-if="rootNode"
      :node="rootNode"
      :focused-node-id="focusedNodeId"
      :is-root="true"
      @activate-tab="(tabId, nodeId) => emit('activateTab', tabId, nodeId)"
      @close-tab="(tabId) => emit('closeTab', tabId)"
      @focus-node="(nodeId) => emit('focusNode', nodeId)"
      @resize="(firstId, delta) => emit('resize', firstId, delta)"
      @move-tab="(tabId, targetId, idx) => emit('moveTab', tabId, targetId, idx)"
      @split-with-tab="(tabId, dir, refId) => emit('splitWithTab', tabId, dir, refId)"
    />

    <!-- Empty state when no root -->
    <div v-else class="flex-1">
      <TerminalPlaceholder />
    </div>
  </div>
</template>
