import type { TmuxWindow } from '~/types';
import { PANE_ACTIVE_KEY, createPoller, isPageActive } from '~/composables/usePolling';

const POLL_INTERVAL = 3000;

function signatureOf(list: TmuxWindow[]): string {
  return list.map((w) => `${w.index}:${w.name}:${w.active}`).join('|');
}

export function useTmuxTabs(containerId: Ref<string>) {
  const paneActive = inject(PANE_ACTIVE_KEY, null);
  const { getTmuxActiveWindow, setTmuxActiveWindow } = useUiState();
  const windows = ref<TmuxWindow[]>([]);
  const activeWindowIndex = ref<number | null>(null);

  const defaultWindowIndex = 0;

  let fetchGeneration = 0;
  // Signature of `windows`: an unchanged poll result is not reassigned, so
  // watchers of the list only run on real changes.
  let windowsSignature = '';
  // The active window this instance persisted last, so polling only writes the
  // UI state when the selection actually changed.
  let persistedIndex: number | null = null;
  let fetchFailing = false;

  const poller = createPoller(
    fetchWindows,
    POLL_INTERVAL,
    () => (paneActive?.value ?? true) && isPageActive(),
  );

  function setWindows(list: TmuxWindow[]) {
    windows.value = list;
    windowsSignature = signatureOf(list);
  }

  function persistActiveWindow(index: number) {
    persistedIndex = index;
    setTmuxActiveWindow(containerId.value, index);
  }

  async function fetchWindows() {
    const currentGeneration = ++fetchGeneration;
    try {
      const data = await $fetch<TmuxWindow[]>(`/api/containers/${containerId.value}/panes`);

      // Discard stale response if containerId changed during fetch
      if (currentGeneration !== fetchGeneration) return;
      fetchFailing = false;

      if (signatureOf(data) !== windowsSignature) setWindows(data);

      // If active window was removed externally, pick first available
      if (activeWindowIndex.value != null && !data.some((w) => w.index === activeWindowIndex.value)) {
        activeWindowIndex.value = data.length > 0 ? data[0]!.index : null;
      }

      // Auto-select first window when nothing is active
      if (activeWindowIndex.value == null && data.length > 0) {
        activeWindowIndex.value = data[0]!.index;
      }

      // Persist for reopen
      if (activeWindowIndex.value != null && activeWindowIndex.value !== persistedIndex) {
        persistActiveWindow(activeWindowIndex.value);
      }
    } catch (err) {
      // The container may be stopped or removed: log once per failure streak.
      if (!fetchFailing) console.warn(`[tmux] Failed to list the windows of ${containerId.value}:`, err);
      fetchFailing = true;
    }
  }

  async function init() {
    // Select the window saved for this container before the first fetch, which
    // keeps it when it still exists (and falls back to the first window).
    const saved = getTmuxActiveWindow(containerId.value);
    if (saved != null) activeWindowIndex.value = saved;

    await poller.trigger();
    startPolling();
  }

  function startPolling() {
    poller.start();
  }

  function stopPolling() {
    poller.stop();
  }

  async function createWindow(name?: string): Promise<TmuxWindow | null> {
    try {
      const window = await $fetch<TmuxWindow>(
        `/api/containers/${containerId.value}/panes`,
        { method: 'POST', body: name ? { name } : undefined },
      );
      await fetchWindows();
      activeWindowIndex.value = window.index;
      persistActiveWindow(window.index);
      return window;
    } catch (err) {
      console.warn(`[tmux] Failed to create a window in ${containerId.value}:`, err);
      return null;
    }
  }

  async function renameWindow(windowIndex: number, newName: string): Promise<boolean> {
    try {
      await $fetch(`/api/containers/${containerId.value}/panes/${windowIndex}`, {
        method: 'PUT',
        body: { newName },
      });

      // Update windows array
      const win = windows.value.find((w) => w.index === windowIndex);
      if (win) win.name = newName;
      windowsSignature = signatureOf(windows.value);

      return true;
    } catch (err) {
      console.warn(`[tmux] Failed to rename window ${windowIndex} of ${containerId.value}:`, err);
      return false;
    }
  }

  async function closeWindow(windowIndex: number) {
    try {
      await $fetch(`/api/containers/${containerId.value}/panes/${windowIndex}`, {
        method: 'DELETE',
      });
    } catch (err) {
      // Window may already be gone; the next poll shows the real list.
      console.warn(`[tmux] Failed to close window ${windowIndex} of ${containerId.value}:`, err);
    }
    setWindows(windows.value.filter((w) => w.index !== windowIndex));
    if (activeWindowIndex.value === windowIndex) {
      activeWindowIndex.value = windows.value.length > 0 ? windows.value[0]!.index : null;
    }
    if (activeWindowIndex.value != null) {
      persistActiveWindow(activeWindowIndex.value);
    }
  }

  function activateWindow(windowIndex: number) {
    activeWindowIndex.value = windowIndex;
    persistActiveWindow(windowIndex);
  }

  function destroy() {
    poller.dispose();
  }

  // Re-init when containerId changes
  watch(containerId, () => {
    stopPolling();
    setWindows([]);
    activeWindowIndex.value = null;
    persistedIndex = null;
    fetchFailing = false;
    void init();
  });

  // Start on creation
  void init();

  return {
    windows,
    activeWindowIndex,
    defaultWindowIndex,
    createWindow,
    renameWindow,
    closeWindow,
    activateWindow,
    destroy,
  };
}
