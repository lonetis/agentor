const MIN_WIDTH = 200;
const MAX_VIEWPORT_RATIO = 0.9;
const COLLAPSE_THRESHOLD = 120;
const MOBILE_BREAKPOINT = 768;

function getMaxWidth() {
  if (typeof window === 'undefined') return 1200;
  return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * MAX_VIEWPORT_RATIO));
}

export function useSidebarResize() {
  const { state, setSidebarWidth, setSidebarCollapsed } = useUiState();
  const sidebarWidth = ref(state.value.sidebar.width);
  const isDragging = ref(false);
  const isCollapsed = ref(state.value.sidebar.collapsed);
  const isMobile = ref(false);

  let activeMoveHandler: ((ev: MouseEvent) => void) | null = null;
  let activeUpHandler: (() => void) | null = null;
  let rafId = 0;
  let pendingX = 0;
  let lastValidWidth = sidebarWidth.value;

  function cleanupDragListeners() {
    if (activeMoveHandler) {
      document.removeEventListener('mousemove', activeMoveHandler);
      activeMoveHandler = null;
    }
    if (activeUpHandler) {
      document.removeEventListener('mouseup', activeUpHandler);
      activeUpHandler = null;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function applyPending() {
    rafId = 0;
    const maxWidth = getMaxWidth();
    if (pendingX < COLLAPSE_THRESHOLD) {
      // Snap preview to 0 — release will commit the collapse
      sidebarWidth.value = 0;
    } else {
      sidebarWidth.value = Math.min(maxWidth, Math.max(MIN_WIDTH, pendingX));
      lastValidWidth = sidebarWidth.value;
    }
  }

  function startDrag(event: MouseEvent) {
    if (isCollapsed.value) return;
    event.preventDefault();
    isDragging.value = true;
    pendingX = event.clientX;
    lastValidWidth = sidebarWidth.value;
    document.body.classList.add('split-dragging');

    activeMoveHandler = (ev: MouseEvent) => {
      pendingX = ev.clientX;
      if (!rafId) rafId = requestAnimationFrame(applyPending);
    };

    activeUpHandler = () => {
      isDragging.value = false;
      document.body.classList.remove('split-dragging');
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }

      if (pendingX < COLLAPSE_THRESHOLD) {
        // Commit collapse but keep the last valid width so re-expand feels right
        sidebarWidth.value = lastValidWidth;
        setSidebarWidth(lastValidWidth);
        isCollapsed.value = true;
        if (!isMobile.value) setSidebarCollapsed(true);
      } else {
        const maxWidth = getMaxWidth();
        sidebarWidth.value = Math.min(maxWidth, Math.max(MIN_WIDTH, pendingX));
        setSidebarWidth(sidebarWidth.value);
      }
      cleanupDragListeners();
    };

    document.addEventListener('mousemove', activeMoveHandler);
    document.addEventListener('mouseup', activeUpHandler);
  }

  function toggleCollapse() {
    isCollapsed.value = !isCollapsed.value;
    if (!isMobile.value) setSidebarCollapsed(isCollapsed.value);
  }

  function checkMobile() {
    const wasMobile = isMobile.value;
    isMobile.value = window.innerWidth < MOBILE_BREAKPOINT;
    // Mobile visibility is temporary; restore the desktop preference on return.
    if (isMobile.value && !wasMobile) {
      isCollapsed.value = true;
    } else if (!isMobile.value && wasMobile) {
      isCollapsed.value = state.value.sidebar.collapsed;
    }
    // Clamp only the rendered width. Viewport changes (e.g. docked DevTools)
    // must not overwrite the user's width or prevent it from growing back.
    if (!isDragging.value) {
      sidebarWidth.value = Math.min(state.value.sidebar.width, getMaxWidth());
    }
  }

  onMounted(() => {
    checkMobile();
    // On mobile, always start collapsed regardless of stored state
    if (isMobile.value) isCollapsed.value = true;
    window.addEventListener('resize', checkMobile);
  });

  onUnmounted(() => {
    if (isDragging.value) {
      document.body.classList.remove('split-dragging');
    }
    cleanupDragListeners();
    window.removeEventListener('resize', checkMobile);
  });

  return { sidebarWidth, isDragging, isCollapsed, isMobile, startDrag, toggleCollapse };
}
