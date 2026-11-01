const MIN_WIDTH = 200;
const MAX_VIEWPORT_RATIO = 0.9;
const COLLAPSE_THRESHOLD = 120;
const KEYBOARD_STEP = 16;
// Narrow windows, and phones held in landscape (short + touch), get the overlay
// sidebar instead of an inline one that would eat a third of the screen.
const MOBILE_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 500px)';

function getMaxWidth() {
  if (typeof window === 'undefined') return 1200;
  return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * MAX_VIEWPORT_RATIO));
}

function clampWidth(width: number) {
  return Math.min(getMaxWidth(), Math.max(MIN_WIDTH, width));
}

export function useSidebarResize() {
  const { state, setSidebarWidth, setSidebarCollapsed } = useUiState();
  // Reactive upper bound (90% of the viewport) for the handle's aria-valuemax.
  const maxSidebarWidth = ref(getMaxWidth());
  // Evaluated during setup (SPA) so a phone never paints the inline sidebar
  // before the first mount.
  const mobileQuery = typeof window === 'undefined' ? null : window.matchMedia(MOBILE_QUERY);
  const sidebarWidth = ref(state.value.sidebar.width);
  const isDragging = ref(false);
  const isMobile = ref(mobileQuery?.matches ?? false);
  // On mobile, always start collapsed regardless of stored state (not persisted)
  const isCollapsed = ref(isMobile.value || state.value.sidebar.collapsed);

  let dragEl: HTMLElement | null = null;
  let rafId = 0;
  let dragStartX = 0;
  let dragStartWidth = 0;
  let pendingWidth = 0;
  let lastValidWidth = sidebarWidth.value;

  function applyPending() {
    rafId = 0;
    if (pendingWidth < COLLAPSE_THRESHOLD) {
      // Snap preview to 0 — release will commit the collapse
      sidebarWidth.value = 0;
    } else {
      sidebarWidth.value = clampWidth(pendingWidth);
      lastValidWidth = sidebarWidth.value;
    }
  }

  function onPointerMove(ev: PointerEvent) {
    // Delta-based, so the grab offset inside the (wide) hit area and any
    // safe-area inset left of the sidebar never make the width jump.
    pendingWidth = dragStartWidth + (ev.clientX - dragStartX);
    if (!rafId) rafId = requestAnimationFrame(applyPending);
  }

  function endDrag() {
    if (!dragEl) return;
    dragEl.removeEventListener('pointermove', onPointerMove);
    dragEl.removeEventListener('pointerup', onPointerUp);
    dragEl.removeEventListener('pointercancel', onPointerCancel);
    dragEl.removeEventListener('lostpointercapture', onPointerCancel);
    dragEl = null;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    isDragging.value = false;
    document.body.classList.remove('split-dragging');
  }

  function onPointerUp() {
    endDrag();
    if (pendingWidth < COLLAPSE_THRESHOLD) {
      // Commit collapse but keep the last valid width so re-expand feels right
      sidebarWidth.value = lastValidWidth;
      setSidebarWidth(lastValidWidth);
      isCollapsed.value = true;
      if (!isMobile.value) setSidebarCollapsed(true);
    } else {
      sidebarWidth.value = clampWidth(pendingWidth);
      setSidebarWidth(sidebarWidth.value);
    }
  }

  /** The gesture was taken away (OS gesture, capture lost): keep the last valid width. */
  function onPointerCancel() {
    endDrag();
    sidebarWidth.value = lastValidWidth;
    setSidebarWidth(lastValidWidth);
  }

  function startDrag(event: PointerEvent) {
    if (isCollapsed.value || dragEl || event.button !== 0) return;
    event.preventDefault();
    dragEl = event.currentTarget as HTMLElement;
    dragEl.setPointerCapture(event.pointerId);
    dragEl.addEventListener('pointermove', onPointerMove);
    dragEl.addEventListener('pointerup', onPointerUp);
    dragEl.addEventListener('pointercancel', onPointerCancel);
    dragEl.addEventListener('lostpointercapture', onPointerCancel);
    isDragging.value = true;
    dragStartX = event.clientX;
    dragStartWidth = sidebarWidth.value;
    pendingWidth = dragStartWidth;
    lastValidWidth = sidebarWidth.value;
    document.body.classList.add('split-dragging');
  }

  /** Keyboard resize of the handle (arrow keys). */
  function nudgeWidth(delta: number) {
    if (isCollapsed.value) return;
    sidebarWidth.value = clampWidth(sidebarWidth.value + delta);
    setSidebarWidth(sidebarWidth.value);
  }

  function toggleCollapse() {
    isCollapsed.value = !isCollapsed.value;
    if (!isMobile.value) setSidebarCollapsed(isCollapsed.value);
  }

  function checkMobile() {
    const wasMobile = isMobile.value;
    isMobile.value = mobileQuery?.matches ?? false;
    // Auto-collapse when entering mobile (transient — never persisted)
    if (isMobile.value && !wasMobile) {
      isCollapsed.value = true;
      // The handle unmounts on mobile, so a drag in progress can never finish.
      endDrag();
    }
    // Clamp width down if the viewport shrank below the current size
    const maxWidth = getMaxWidth();
    maxSidebarWidth.value = maxWidth;
    if (sidebarWidth.value > maxWidth) {
      sidebarWidth.value = maxWidth;
      setSidebarWidth(maxWidth);
    }
  }

  onMounted(() => {
    checkMobile();
    mobileQuery?.addEventListener('change', checkMobile);
    // The media query only flips at the breakpoint; the width clamp needs every resize.
    window.addEventListener('resize', checkMobile);
  });

  onUnmounted(() => {
    endDrag();
    mobileQuery?.removeEventListener('change', checkMobile);
    window.removeEventListener('resize', checkMobile);
  });

  return {
    sidebarWidth,
    isDragging,
    isCollapsed,
    isMobile,
    minWidth: MIN_WIDTH,
    maxWidth: readonly(maxSidebarWidth),
    keyboardStep: KEYBOARD_STEP,
    startDrag,
    nudgeWidth,
    toggleCollapse,
  };
}
