const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 200;
const MAX_WIDTH = 700;
const MOBILE_BREAKPOINT = 768;
const STORAGE_KEY_WIDTH = 'agentor-sidebar-width';
const STORAGE_KEY_COLLAPSED = 'agentor-sidebar-collapsed';

function loadStoredWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_WIDTH);
    if (stored) {
      const val = Number(stored);
      if (val >= MIN_WIDTH && val <= MAX_WIDTH) return val;
    }
  } catch {}
  return DEFAULT_WIDTH;
}

function loadStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_COLLAPSED) === 'true';
  } catch {}
  return false;
}

export function useSidebarResize() {
  const sidebarWidth = ref(loadStoredWidth());
  const isDragging = ref(false);
  const isCollapsed = ref(loadStoredCollapsed());
  const isMobile = ref(false);

  let activeMoveHandler: ((ev: MouseEvent) => void) | null = null;
  let activeUpHandler: (() => void) | null = null;
  let rafId = 0;
  let pendingX = 0;

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

  function startDrag(event: MouseEvent) {
    if (isCollapsed.value) return;
    event.preventDefault();
    isDragging.value = true;
    document.body.classList.add('split-dragging');

    activeMoveHandler = (ev: MouseEvent) => {
      pendingX = ev.clientX;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          sidebarWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, pendingX));
        });
      }
    };

    activeUpHandler = () => {
      isDragging.value = false;
      document.body.classList.remove('split-dragging');
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      sidebarWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, pendingX));
      try { localStorage.setItem(STORAGE_KEY_WIDTH, String(sidebarWidth.value)); } catch {}
      cleanupDragListeners();
    };

    document.addEventListener('mousemove', activeMoveHandler);
    document.addEventListener('mouseup', activeUpHandler);
  }

  function toggleCollapse() {
    isCollapsed.value = !isCollapsed.value;
    try { localStorage.setItem(STORAGE_KEY_COLLAPSED, String(isCollapsed.value)); } catch {}
  }

  function checkMobile() {
    const wasMobile = isMobile.value;
    isMobile.value = window.innerWidth < MOBILE_BREAKPOINT;
    // Auto-collapse when transitioning to mobile, auto-expand when leaving
    if (isMobile.value && !wasMobile) {
      isCollapsed.value = true;
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
