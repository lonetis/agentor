export function useSidebarResize() {
  const sidebarWidth = ref(280);
  const isDragging = ref(false);

  const MIN_WIDTH = 200;
  const MAX_WIDTH = 400;

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
    document.body.classList.add('split-dragging');

    activeMoveHandler = (ev: MouseEvent) => {
      sidebarWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, ev.clientX));
    };

    activeUpHandler = () => {
      isDragging.value = false;
      document.body.classList.remove('split-dragging');
      cleanupDragListeners();
    };

    document.addEventListener('mousemove', activeMoveHandler);
    document.addEventListener('mouseup', activeUpHandler);
  }

  onUnmounted(() => {
    if (isDragging.value) {
      document.body.classList.remove('split-dragging');
    }
    cleanupDragListeners();
  });

  return { sidebarWidth, isDragging, startDrag };
}
