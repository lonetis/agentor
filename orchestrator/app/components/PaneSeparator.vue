<script setup lang="ts">
import type { SplitDirection } from '~/types';

const props = withDefaults(defineProps<{
  direction?: SplitDirection;
  /** Separator position in percent of the container (aria-valuenow). */
  position?: number;
}>(), {
  direction: 'horizontal',
});

const emit = defineEmits<{
  /** Once per drag / key press, before the first `resize`. */
  resizeStart: [];
  resize: [delta: number];
}>();

const KEYBOARD_STEP = 16;

const isDragging = ref(false);
const isHorizontal = computed(() => props.direction === 'horizontal');

let dragEl: HTMLElement | null = null;
let lastPos = 0;
let pendingDelta = 0;
let rafId = 0;

function bodyClass() {
  return isHorizontal.value ? 'split-dragging' : 'split-dragging-v';
}

function pointerPos(ev: PointerEvent) {
  return isHorizontal.value ? ev.clientX : ev.clientY;
}

function flush() {
  rafId = 0;
  if (pendingDelta === 0) return;
  const delta = pendingDelta;
  pendingDelta = 0;
  emit('resize', delta);
}

function onPointerMove(ev: PointerEvent) {
  const pos = pointerPos(ev);
  pendingDelta += pos - lastPos;
  lastPos = pos;
  if (!rafId) rafId = requestAnimationFrame(flush);
}

function endDrag() {
  if (!dragEl) return;
  dragEl.removeEventListener('pointermove', onPointerMove);
  dragEl.removeEventListener('pointerup', endDrag);
  dragEl.removeEventListener('pointercancel', endDrag);
  dragEl.removeEventListener('lostpointercapture', endDrag);
  dragEl = null;
  if (rafId) cancelAnimationFrame(rafId);
  // Apply the movement still waiting for its frame.
  flush();
  isDragging.value = false;
  document.body.classList.remove('split-dragging', 'split-dragging-v');
}

function startDrag(event: PointerEvent) {
  if (dragEl || event.button !== 0) return;
  event.preventDefault();
  dragEl = event.currentTarget as HTMLElement;
  dragEl.setPointerCapture(event.pointerId);
  dragEl.addEventListener('pointermove', onPointerMove);
  dragEl.addEventListener('pointerup', endDrag);
  dragEl.addEventListener('pointercancel', endDrag);
  dragEl.addEventListener('lostpointercapture', endDrag);
  isDragging.value = true;
  lastPos = pointerPos(event);
  pendingDelta = 0;
  document.body.classList.add(bodyClass());
  emit('resizeStart');
}

function onKeydown(event: KeyboardEvent) {
  const [decrease, increase] = isHorizontal.value ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  if (event.key !== decrease && event.key !== increase) return;
  event.preventDefault();
  emit('resizeStart');
  emit('resize', event.key === increase ? KEYBOARD_STEP : -KEYBOARD_STEP);
}

onUnmounted(endDrag);
</script>

<template>
  <div
    class="pane-separator"
    :class="[
      isHorizontal ? 'pane-separator--h' : 'pane-separator--v',
      { dragging: isDragging },
    ]"
    role="separator"
    :aria-orientation="isHorizontal ? 'vertical' : 'horizontal'"
    aria-label="Resize panes"
    :aria-valuenow="position"
    aria-valuemin="0"
    aria-valuemax="100"
    tabindex="0"
    @pointerdown="startDrag"
    @keydown="onKeydown"
  />
</template>

<style scoped>
.pane-separator {
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s;
  position: relative;
  touch-action: none;
  outline: none;
}

/* Hairline through the middle, so side-by-side panes don't merge visually. */
.pane-separator::after {
  content: '';
  position: absolute;
  background: var(--pane-tab-border);
  pointer-events: none;
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

.pane-separator--h::after {
  top: 0;
  bottom: 0;
  left: calc(50% - 0.5px);
  width: 1px;
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

.pane-separator--v::after {
  left: 0;
  right: 0;
  top: calc(50% - 0.5px);
  height: 1px;
}

.pane-separator:hover,
.pane-separator:focus-visible,
.pane-separator.dragging {
  background: var(--pane-tab-active-accent);
}

.pane-separator:hover::after,
.pane-separator:focus-visible::after,
.pane-separator.dragging::after {
  background: transparent;
}

/* Fingers need a bigger grab area. */
@media (pointer: coarse) {
  .pane-separator--h::before {
    left: -12px;
    right: -12px;
  }

  .pane-separator--v::before {
    top: -12px;
    bottom: -12px;
  }
}
</style>
