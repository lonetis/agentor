import type { TmuxWindow } from '~/types';

const POLL_INTERVAL = 3000;

// Persists active window across outer tab close/reopen
const lastActiveWindowMap = new Map<string, string>();

export function useTmuxTabs(containerId: Ref<string>) {
  const windows = ref<TmuxWindow[]>([]);
  const activeWindowName = ref<string | null>(null);

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
      if (activeWindowName.value && !data.some((w) => w.name === activeWindowName.value)) {
        activeWindowName.value = data.length > 0 ? data[0]!.name : null;
      }

      // Auto-select first window when nothing is active
      if (!activeWindowName.value && data.length > 0) {
        activeWindowName.value = data[0]!.name;
      }

      // Persist for reopen
      if (activeWindowName.value) {
        lastActiveWindowMap.set(containerId.value, activeWindowName.value);
      }
    } catch {
      // Container may be stopped or removed
    }
  }

  async function init() {
    await fetchWindows();

    // Restore last active window if it still exists
    const saved = lastActiveWindowMap.get(containerId.value);
    if (saved && windows.value.some((w) => w.name === saved)) {
      activeWindowName.value = saved;
    } else if (windows.value.length > 0 && !activeWindowName.value) {
      activeWindowName.value = windows.value[0]!.name;
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

  async function createWindow(name?: string): Promise<string | null> {
    try {
      const { windowName } = await $fetch<{ windowName: string }>(
        `/api/containers/${containerId.value}/panes`,
        { method: 'POST', body: name ? { name } : undefined },
      );
      await fetchWindows();
      activeWindowName.value = windowName;
      lastActiveWindowMap.set(containerId.value, windowName);
      return windowName;
    } catch {
      return null;
    }
  }

  async function renameWindow(oldName: string, newName: string): Promise<boolean> {
    try {
      await $fetch(`/api/containers/${containerId.value}/panes/${oldName}`, {
        method: 'PUT',
        body: { newName },
      });

      // Update windows array
      const win = windows.value.find((w) => w.name === oldName);
      if (win) win.name = newName;

      // Update active window name if it was the renamed window
      if (activeWindowName.value === oldName) {
        activeWindowName.value = newName;
      }

      // Update persisted active window
      const saved = lastActiveWindowMap.get(containerId.value);
      if (saved === oldName) {
        lastActiveWindowMap.set(containerId.value, newName);
      }

      return true;
    } catch {
      return false;
    }
  }

  async function closeWindow(name: string) {
    try {
      await $fetch(`/api/containers/${containerId.value}/panes/${name}`, {
        method: 'DELETE',
      });
    } catch {
      // Window may already be gone
    }
    windows.value = windows.value.filter((w) => w.name !== name);
    if (activeWindowName.value === name) {
      activeWindowName.value = windows.value.length > 0 ? windows.value[0]!.name : null;
    }
    if (activeWindowName.value) {
      lastActiveWindowMap.set(containerId.value, activeWindowName.value);
    }
  }

  function activateWindow(name: string) {
    activeWindowName.value = name;
    lastActiveWindowMap.set(containerId.value, name);
  }

  function destroy() {
    stopPolling();
  }

  // Re-init when containerId changes
  watch(containerId, () => {
    stopPolling();
    windows.value = [];
    activeWindowName.value = null;
    init();
  });

  // Start on creation
  init();

  return {
    windows,
    activeWindowName,
    createWindow,
    renameWindow,
    closeWindow,
    activateWindow,
    destroy,
  };
}
