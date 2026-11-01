// Touch gestures for the terminal. xterm.js has no touch selection, and with
// tmux in the alternate screen its own touch scrolling does nothing, so the
// terminal pane handles touch itself:
//
//   one-finger swipe   → scroll (scrollback through tmux), with momentum
//   long-press (+drag) → select the word under the finger, drag to extend
//   two-finger pinch   → change the font size
//   tap                → left to the browser (focuses the terminal / opens links)

export interface TerminalTouchHandlers {
  /** Scroll by `pixels`; positive moves towards newer output (finger swiping up). */
  scrollPixels(pixels: number): void;
  /** Long-press at a point; returns true when a selection was started. */
  startSelection(clientX: number, clientY: number): boolean;
  /** Extend the active touch selection to a point. */
  extendSelection(clientX: number, clientY: number): void;
  /** A touch selection gesture finished (finger lifted). */
  endSelection(): void;
  getFontSize(): number;
  /** Live font size while pinching. */
  previewFontSize(size: number): void;
  /** Final font size when the pinch ends. */
  commitFontSize(size: number): void;
}

const LONG_PRESS_MS = 450;
const MOVE_SLOP_PX = 10;
const MOMENTUM_MIN_VELOCITY = 0.05; // px per ms
const MOMENTUM_FRICTION = 0.95; // per 16ms frame
const VELOCITY_WINDOW_MS = 100;

type GestureState = 'idle' | 'pending' | 'scroll' | 'select' | 'pinch';

interface Sample {
  y: number;
  t: number;
}

function distance(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** Attaches the gesture handling to `el`; returns a cleanup function. */
export function attachTerminalTouch(el: HTMLElement, handlers: TerminalTouchHandlers): () => void {
  let state: GestureState = 'idle';
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let samples: Sample[] = [];
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let momentumRaf = 0;
  let pinchStartDistance = 0;
  let pinchStartSize = 0;
  let pinchSize = 0;

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function stopMomentum() {
    if (momentumRaf) {
      cancelAnimationFrame(momentumRaf);
      momentumRaf = 0;
    }
  }

  function startMomentum(velocity: number) {
    let v = velocity;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      handlers.scrollPixels(v * dt);
      v *= Math.pow(MOMENTUM_FRICTION, dt / 16);
      momentumRaf = Math.abs(v) >= MOMENTUM_MIN_VELOCITY ? requestAnimationFrame(step) : 0;
    };
    momentumRaf = requestAnimationFrame(step);
  }

  function releaseVelocity(): number {
    const now = performance.now();
    const recent = samples.filter((s) => now - s.t <= VELOCITY_WINDOW_MS);
    if (recent.length < 2) return 0;
    const first = recent[0]!;
    const last = recent[recent.length - 1]!;
    const dt = last.t - first.t;
    // Swiping up (negative dy) scrolls towards newer output (positive).
    return dt > 0 ? -(last.y - first.y) / dt : 0;
  }

  function onTouchStart(e: TouchEvent) {
    stopMomentum();
    // The terminal owns every gesture inside it; keep xterm.js's own touch
    // handlers (which scroll an empty alternate-screen viewport) out of it.
    e.stopPropagation();

    if (e.touches.length === 2) {
      clearLongPress();
      state = 'pinch';
      pinchStartDistance = distance(e.touches[0]!, e.touches[1]!);
      pinchStartSize = handlers.getFontSize();
      pinchSize = pinchStartSize;
      return;
    }
    if (e.touches.length !== 1) {
      clearLongPress();
      state = 'idle';
      return;
    }

    const t = e.touches[0]!;
    state = 'pending';
    startX = t.clientX;
    startY = t.clientY;
    lastY = t.clientY;
    samples = [{ y: t.clientY, t: performance.now() }];
    clearLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (state !== 'pending') return;
      if (handlers.startSelection(startX, startY)) {
        state = 'select';
        navigator.vibrate?.(10);
      }
    }, LONG_PRESS_MS);
  }

  function onTouchMove(e: TouchEvent) {
    e.stopPropagation();

    if (state === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      if (pinchStartDistance <= 0) return;
      const scale = distance(e.touches[0]!, e.touches[1]!) / pinchStartDistance;
      const next = Math.round(pinchStartSize * scale);
      if (next !== pinchSize) {
        pinchSize = next;
        handlers.previewFontSize(next);
      }
      return;
    }
    if (e.touches.length !== 1) return;

    const t = e.touches[0]!;
    if (state === 'pending') {
      if (Math.hypot(t.clientX - startX, t.clientY - startY) < MOVE_SLOP_PX) return;
      clearLongPress();
      state = 'scroll';
    }

    if (state === 'scroll') {
      e.preventDefault();
      handlers.scrollPixels(lastY - t.clientY);
      lastY = t.clientY;
      samples.push({ y: t.clientY, t: performance.now() });
      if (samples.length > 20) samples.shift();
    } else if (state === 'select') {
      e.preventDefault();
      handlers.extendSelection(t.clientX, t.clientY);
    }
  }

  function onTouchEnd(e: TouchEvent) {
    e.stopPropagation();
    clearLongPress();

    if (state === 'pinch') {
      // Wait until both fingers are up before committing.
      if (e.touches.length > 0) return;
      e.preventDefault();
      if (pinchSize !== pinchStartSize) handlers.commitFontSize(pinchSize);
      state = 'idle';
      return;
    }
    if (state === 'scroll') {
      // A swipe is not a tap: suppress the synthetic click so the swipe never
      // moves focus or activates a link.
      e.preventDefault();
      const v = releaseVelocity();
      if (Math.abs(v) >= MOMENTUM_MIN_VELOCITY * 4) startMomentum(v);
    } else if (state === 'select') {
      // The synthetic mousedown of a tap would clear the new selection.
      e.preventDefault();
      handlers.endSelection();
    }
    state = 'idle';
  }

  function onTouchCancel() {
    clearLongPress();
    if (state === 'select') handlers.endSelection();
    state = 'idle';
  }

  // Android fires `contextmenu` on long-press; the terminal shows its own
  // selection actions instead of the browser menu.
  function onContextMenu(e: Event) {
    if (state === 'select' || state === 'pending') e.preventDefault();
  }

  // iOS Safari pinch events (non-standard); the terminal handles pinch itself.
  function onGesture(e: Event) {
    e.preventDefault();
  }

  const opts = { capture: true, passive: false } as const;
  el.addEventListener('touchstart', onTouchStart, opts);
  el.addEventListener('touchmove', onTouchMove, opts);
  el.addEventListener('touchend', onTouchEnd, opts);
  el.addEventListener('touchcancel', onTouchCancel, opts);
  el.addEventListener('contextmenu', onContextMenu, { capture: true });
  el.addEventListener('gesturestart', onGesture, opts);
  el.addEventListener('gesturechange', onGesture, opts);

  return () => {
    clearLongPress();
    stopMomentum();
    el.removeEventListener('touchstart', onTouchStart, opts);
    el.removeEventListener('touchmove', onTouchMove, opts);
    el.removeEventListener('touchend', onTouchEnd, opts);
    el.removeEventListener('touchcancel', onTouchCancel, opts);
    el.removeEventListener('contextmenu', onContextMenu, { capture: true });
    el.removeEventListener('gesturestart', onGesture, opts);
    el.removeEventListener('gesturechange', onGesture, opts);
  };
}
