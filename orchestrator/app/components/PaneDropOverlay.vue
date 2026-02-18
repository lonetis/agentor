<script setup lang="ts">
import type { DropZone } from '~/types';

const props = defineProps<{
  nodeId: string;
}>();

const emit = defineEmits<{
  drop: [zone: DropZone, nodeId: string];
}>();

const hoveredZone = ref<DropZone | null>(null);
const overlayEl = ref<HTMLElement | null>(null);

const EDGE_THRESHOLD = 0.25;

function getZoneFromPosition(clientX: number, clientY: number): DropZone {
  if (!overlayEl.value) return 'center';
  const rect = overlayEl.value.getBoundingClientRect();
  const fracX = (clientX - rect.left) / rect.width;
  const fracY = (clientY - rect.top) / rect.height;

  // Distance to each edge (0 = at edge, 0.5 = center)
  const distLeft = fracX;
  const distRight = 1 - fracX;
  const distTop = fracY;
  const distBottom = 1 - fracY;

  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  if (minDist >= EDGE_THRESHOLD) return 'center';

  if (minDist === distLeft) return 'left';
  if (minDist === distRight) return 'right';
  if (minDist === distTop) return 'top';
  return 'bottom';
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  hoveredZone.value = getZoneFromPosition(event.clientX, event.clientY);
}

function onDragLeave(event: DragEvent) {
  const related = event.relatedTarget as HTMLElement | null;
  if (!overlayEl.value?.contains(related)) {
    hoveredZone.value = null;
  }
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  const zone = getZoneFromPosition(event.clientX, event.clientY);
  hoveredZone.value = null;
  emit('drop', zone, props.nodeId);
}

function onDragEnd() {
  hoveredZone.value = null;
}

// Highlight position classes per zone
const highlightClass = computed(() => {
  switch (hoveredZone.value) {
    case 'left': return 'inset-y-0 left-0 w-1/2';
    case 'right': return 'inset-y-0 right-0 w-1/2';
    case 'top': return 'inset-x-0 top-0 h-1/2';
    case 'bottom': return 'inset-x-0 bottom-0 h-1/2';
    case 'center': return 'inset-0';
    default: return '';
  }
});

// Vertical split icon (for left/right)
const isVerticalSplit = computed(() => hoveredZone.value === 'left' || hoveredZone.value === 'right');
// Horizontal split icon (for top/bottom)
const isHorizontalSplit = computed(() => hoveredZone.value === 'top' || hoveredZone.value === 'bottom');
const isMerge = computed(() => hoveredZone.value === 'center');
</script>

<template>
  <div
    ref="overlayEl"
    class="absolute inset-0 z-20"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @dragend="onDragEnd"
  >
    <!-- Zone highlight -->
    <div
      v-if="hoveredZone"
      class="absolute flex items-center justify-center transition-all duration-100 rounded"
      :class="[
        highlightClass,
        isMerge ? 'bg-blue-500/15 border-2 border-blue-500/40' : 'bg-blue-500/20 border-2 border-blue-500/50',
      ]"
    >
      <!-- Vertical split icon (left/right) -->
      <svg
        v-if="isVerticalSplit"
        class="w-8 h-8 text-blue-400 opacity-80"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3v18M3 3h18v18H3z" />
      </svg>

      <!-- Horizontal split icon (top/bottom) -->
      <svg
        v-if="isHorizontalSplit"
        class="w-8 h-8 text-blue-400 opacity-80"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 12h18M3 3h18v18H3z" />
      </svg>

      <!-- Merge icon (center) -->
      <svg
        v-if="isMerge"
        class="w-8 h-8 text-blue-400 opacity-80"
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </div>
  </div>
</template>
