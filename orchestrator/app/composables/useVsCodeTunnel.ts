import type { VsCodeTunnelStatus } from '~/types';

export function useVsCodeTunnel(containerId: Ref<string | undefined>) {
  const status = ref<VsCodeTunnelStatus>({ status: 'stopped' });

  async function fetchStatus() {
    if (!containerId.value) {
      status.value = { status: 'stopped' };
      return;
    }
    try {
      status.value = await $fetch<VsCodeTunnelStatus>(
        `/api/containers/${containerId.value}/vscode-tunnel/status`
      );
    } catch {
      status.value = { status: 'stopped' };
    }
  }

  async function start() {
    if (!containerId.value) return;
    try {
      await $fetch(`/api/containers/${containerId.value}/vscode-tunnel/start`, { method: 'POST' });
      await fetchStatus();
    } catch {}
  }

  async function stop() {
    if (!containerId.value) return;
    try {
      await $fetch(`/api/containers/${containerId.value}/vscode-tunnel/stop`, { method: 'POST' });
      await fetchStatus();
    } catch {}
  }

  watch(containerId, fetchStatus, { immediate: true });
  usePolling(fetchStatus, 3_000);

  return { status, start, stop, refresh: fetchStatus };
}
