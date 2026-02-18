<script setup lang="ts">
import type { SplitDirection } from '~/types';

const props = withDefaults(defineProps<{
  direction?: SplitDirection;
}>(), {
  direction: 'horizontal',
});

const emit = defineEmits<{
  resize: [delta: number];
}>();

const isDragging = ref(false);

let activeMoveHandler: ((ev: MouseEvent) => void) | null = null;
let activeUpHandler: (() => void) | null = null;

function cleanupDragListeners() {
  if (activeMoveHandler) {
    document.removeEventListener('mousemove', activeMoveHandler);
    activeMoveHandler = null;
  }
  if (activeUpHandler) {
    document.removeEventListener('mouseup', activeUpHandler);
    activeUpHandler = null;
  }
}

function startDrag(event: MouseEvent) {
  event.preventDefault();
  isDragging.value = true;

  const isHorizontal = props.direction === 'horizontal';
  const bodyClass = isHorizontal ? 'split-dragging' : 'split-dragging-v';
  document.body.classList.add(bodyClass);

  let lastPos = isHorizontal ? event.clientX : event.clientY;

  activeMoveHandler = (ev: MouseEvent) => {
    const currentPos = isHorizontal ? ev.clientX : ev.clientY;
    const delta = currentPos - lastPos;
    lastPos = currentPos;
    emit('resize', delta);
  };

  activeUpHandler = () => {
    isDragging.value = false;
    document.body.classList.remove(bodyClass);
    cleanupDragListeners();
  };

  document.addEventListener('mousemove', activeMoveHandler);
  document.addEventListener('mouseup', activeUpHandler);
}

onUnmounted(() => {
  if (isDragging.value) {
    document.body.classList.remove('split-dragging', 'split-dragging-v');
  }
  cleanupDragListeners();
});
</script>

<template>
  <div
    class="pane-separator"
    :class="[
      direction === 'horizontal' ? 'pane-separator--h' : 'pane-separator--v',
      { dragging: isDragging },
    ]"
    @mousedown="startDrag"
  />
</template>

<style scoped>
.pane-separator {
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s;
  position: relative;
}

/* Horizontal (col-resize) */
.pane-separator--h {
  width: 4px;
  cursor: col-resize;
}

.pane-separator--h::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
}

/* Vertical (row-resize) */
.pane-separator--v {
  height: 4px;
  cursor: row-resize;
}

.pane-separator--v::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -4px;
  bottom: -4px;
}

.pane-separator:hover,
.pane-separator.dragging {
  background: #3b82f6;
}
</style>
