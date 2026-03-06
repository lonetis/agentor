import type { TmuxWindow } from '~/types';

const POLL_INTERVAL = 3000;

export function useTmuxTabs(containerId: Ref<string>) {
  const { getTmuxActiveWindow, setTmuxActiveWindow } = useUiState();
  const windows = ref<TmuxWindow[]>([]);
  const activeWindowIndex = ref<number | null>(null);

  const defaultWindowIndex = 0;

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let fetchGeneration = 0;

  async function fetchWindows() {
    const currentGeneration = ++fetchGeneration;
    try {
      const data = await $fetch<TmuxWindow[]>(`/api/containers/${containerId.value}/panes`);

      // Discard stale response if containerId changed during fetch
      if (currentGeneration !== fetchGeneration) return;

      windows.value = data;

      // If active window was removed externally, pick first available
      if (activeWindowIndex.value != null && !data.some((w) => w.index === activeWindowIndex.value)) {
        activeWindowIndex.value = data.length > 0 ? data[0]!.index : null;
      }

      // Auto-select first window when nothing is active
      if (activeWindowIndex.value == null && data.length > 0) {
        activeWindowIndex.value = data[0]!.index;
      }

      // Persist for reopen
      if (activeWindowIndex.value != null) {
        setTmuxActiveWindow(containerId.value, activeWindowIndex.value);
      }
    } catch {
      // Container may be stopped or removed
    }
  }

  async function init() {
    await fetchWindows();

    // Restore last active window if it still exists
    const saved = getTmuxActiveWindow(containerId.value);
    if (saved != null && windows.value.some((w) => w.index === saved)) {
      activeWindowIndex.value = saved;
    } else if (windows.value.length > 0 && activeWindowIndex.value == null) {
      activeWindowIndex.value = windows.value[0]!.index;
    }

    startPolling();
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => fetchWindows(), POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function createWindow(name?: string): Promise<TmuxWindow | null> {
    try {
      const window = await $fetch<TmuxWindow>(
        `/api/containers/${containerId.value}/panes`,
        { method: 'POST', body: name ? { name } : undefined },
      );
      await fetchWindows();
      activeWindowIndex.value = window.index;
      setTmuxActiveWindow(containerId.value, window.index);
      return window;
    } catch {
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

      return true;
    } catch {
      return false;
    }
  }

  async function closeWindow(windowIndex: number) {
    try {
      await $fetch(`/api/containers/${containerId.value}/panes/${windowIndex}`, {
        method: 'DELETE',
      });
    } catch {
      // Window may already be gone
    }
    windows.value = windows.value.filter((w) => w.index !== windowIndex);
    if (activeWindowIndex.value === windowIndex) {
      activeWindowIndex.value = windows.value.length > 0 ? windows.value[0]!.index : null;
    }
    if (activeWindowIndex.value != null) {
      setTmuxActiveWindow(containerId.value, activeWindowIndex.value);
    }
  }

  function activateWindow(windowIndex: number) {
    activeWindowIndex.value = windowIndex;
    setTmuxActiveWindow(containerId.value, windowIndex);
  }

  function destroy() {
    stopPolling();
  }

  // Re-init when containerId changes
  watch(containerId, () => {
    stopPolling();
    windows.value = [];
    activeWindowIndex.value = null;
    init();
  });

  // Start on creation
  init();

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
