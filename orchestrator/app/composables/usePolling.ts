/**
 * Polling primitives for every client-side poller.
 *
 * Polls pause while the page is hidden or the device is offline, and while the
 * pane tab hosting the component is not the shown one (`PANE_ACTIVE_KEY`,
 * provided by PaneTabHost). Runs never overlap, and data that went stale during
 * a pause is refreshed as soon as the pause ends.
 */

/** Provided by PaneTabHost: whether the pane tab hosting a component is the one shown. */
export const PANE_ACTIVE_KEY: InjectionKey<Readonly<Ref<boolean>>> = Symbol('paneActive');

const visible = ref(true);
const online = ref(true);

if (import.meta.client) {
  visible.value = document.visibilityState !== 'hidden';
  online.value = navigator.onLine;
  document.addEventListener('visibilitychange', () => {
    visible.value = document.visibilityState !== 'hidden';
  });
  window.addEventListener('online', () => { online.value = true; });
  window.addEventListener('offline', () => { online.value = false; });
}

/** Whether the page is visible (`document.visibilityState`). */
export const pageVisible: Readonly<Ref<boolean>> = readonly(visible);

/** Whether background requests are worth making: the page is visible and the device is online. */
export function isPageActive(): boolean {
  return visible.value && online.value;
}

export interface Poller {
  /** Resume polling after `stop()` (pollers start stopped). */
  start(): void;
  /** Pause polling; a run in flight still completes. */
  stop(): void;
  /** Run now, even while paused, or once more right after the run in flight. Resolves when done. */
  trigger(): Promise<void>;
  /** Stop for good. */
  dispose(): void;
}

/**
 * Self-rescheduling poller without lifecycle hooks. `fn` runs every
 * `intervalMs` while started and `enabled()` is true. When `enabled()` turns
 * true again after a pause, the next run is due `intervalMs` after the last
 * one, so data that went stale meanwhile refreshes at once while quick flips
 * do not cause bursts.
 *
 * `immediate` treats the data as stale from the start (the first enabled moment
 * runs at once); otherwise the first run comes one interval after creation,
 * like `setInterval`.
 */
export function createPoller(
  fn: () => unknown,
  intervalMs: number,
  enabled: () => boolean,
  options: { immediate?: boolean } = {},
): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let rerunRequested = false;
  let started = false;
  let disposed = false;
  let lastRun = options.immediate ? 0 : Date.now();

  const active = () => started && !disposed && enabled();

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function reschedule() {
    clearTimer();
    // A run in flight reschedules itself when it finishes.
    if (inFlight || !active()) return;
    timer = setTimeout(tick, Math.max(0, intervalMs - (Date.now() - lastRun)));
  }

  function tick() {
    timer = null;
    if (inFlight || !active()) return;
    void run();
  }

  function run(): Promise<void> {
    if (inFlight) {
      rerunRequested = true;
      return inFlight;
    }
    clearTimer();
    inFlight = (async () => {
      try {
        do {
          rerunRequested = false;
          try {
            await fn();
          } catch (err) {
            console.warn('[polling] Poll failed:', err);
          }
          lastRun = Date.now();
        } while (rerunRequested && !disposed);
      } finally {
        inFlight = null;
        reschedule();
      }
    })();
    return inFlight;
  }

  const stopWatching = watch(enabled, reschedule);

  return {
    start() {
      started = true;
      reschedule();
    },
    stop() {
      started = false;
      clearTimer();
    },
    trigger: run,
    dispose() {
      disposed = true;
      started = false;
      clearTimer();
      stopWatching();
    },
  };
}

/**
 * Component-scoped polling: starts on mount, stops on unmount, and pauses
 * while the page is hidden, the device is offline, `options.enabled` is false
 * or the hosting pane tab is not shown. Must be called during setup.
 */
export function usePolling(
  callback: () => unknown,
  intervalMs: number,
  options: { enabled?: MaybeRefOrGetter<boolean> } = {},
): Pick<Poller, 'start' | 'stop' | 'trigger'> {
  const paneActive = inject(PANE_ACTIVE_KEY, null);
  const poller = createPoller(
    callback,
    intervalMs,
    () => isPageActive() && toValue(options.enabled ?? true) && (paneActive?.value ?? true),
  );
  onMounted(poller.start);
  onUnmounted(poller.dispose);
  return { start: poller.start, stop: poller.stop, trigger: poller.trigger };
}

export interface SharedPoller {
  /** Keep the poll running while the calling component is mounted. Call during setup. */
  use(): void;
  /** Run now; see `Poller.trigger`. */
  trigger(): Promise<void>;
}

/**
 * One module-level poll shared by every component using the same data: it runs
 * while at least one subscriber is mounted (fetching at once for the first one)
 * and the page is visible and online.
 */
export function createSharedPoller(fn: () => unknown, intervalMs: number): SharedPoller {
  const subscribers = ref(0);
  const poller = createPoller(fn, intervalMs, () => subscribers.value > 0 && isPageActive(), { immediate: true });
  poller.start();
  return {
    use() {
      onMounted(() => { subscribers.value++; });
      onUnmounted(() => { subscribers.value--; });
    },
    trigger: poller.trigger,
  };
}
