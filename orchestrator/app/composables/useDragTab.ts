import type { DragPayload } from '~/types';

const isDragging = ref(false);
const dragPayload = ref<DragPayload | null>(null);

export function useDragTab() {
  function startDrag(tabId: string, sourceNodeId: string, event: DragEvent) {
    isDragging.value = true;
    dragPayload.value = { tabId, sourceNodeId };

    if (event.dataTransfer) {
      event.dataTransfer.setData('application/x-agentor-tab', JSON.stringify({ tabId, sourceNodeId }));
      event.dataTransfer.effectAllowed = 'move';
    }

    document.body.classList.add('tab-dragging');
  }

  function endDrag() {
    isDragging.value = false;
    dragPayload.value = null;
    document.body.classList.remove('tab-dragging');
  }

  function parseDragData(event: DragEvent): DragPayload | null {
    try {
      const raw = event.dataTransfer?.getData('application/x-agentor-tab');
      if (!raw) return null;
      return JSON.parse(raw) as DragPayload;
    } catch {
      return null;
    }
  }

  return {
    isDragging: readonly(isDragging),
    dragPayload: readonly(dragPayload),
    startDrag,
    endDrag,
    parseDragData,
  };
}
