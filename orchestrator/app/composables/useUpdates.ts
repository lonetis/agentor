import type { UpdateStatus, ApplyResult, PruneResult, UpdatableImage } from '~/types';

export function useUpdates() {
  const status = ref<UpdateStatus | null>(null);
  const isChecking = ref(false);
  const isApplying = ref(false);
  const isPruning = ref(false);
  const isRestarting = ref(false);
  const applyErrors = ref<string[]>([]);
  const applyingImages = ref(new Set<UpdatableImage>());
  const lastPruneResult = ref<PruneResult | null>(null);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  // Self-rescheduling setTimeout (not setInterval) so a slow /api/health — likely
  // during the orchestrator restart this exact loop is waiting on — cannot stack
  // overlapping in-flight requests and burn through the retry budget early.
  let healthPollTimer: ReturnType<typeof setTimeout> | null = null;

  async function fetchStatus() {
    try {
      status.value = await $fetch<UpdateStatus>('/api/updates');
    } catch {
      status.value = null;
    }
  }

  async function checkNow() {
    isChecking.value = true;
    try {
      status.value = await $fetch<UpdateStatus>('/api/updates/check', { method: 'POST' });
    } catch {
      // Ignore — status stays stale
    } finally {
      isChecking.value = false;
    }
  }

  async function applyUpdates() {
    isApplying.value = true;
    applyErrors.value = [];
    try {
      const result = await $fetch<ApplyResult>('/api/updates/apply', { method: 'POST' });
      applyErrors.value = result.errors;

      if (result.orchestratorRestarting) {
        isRestarting.value = true;
        pollHealth();
      } else {
        await fetchStatus();
      }
    } catch (err: unknown) {
      applyErrors.value = [fetchErrorMessage(err, 'Update failed')];
    } finally {
      isApplying.value = false;
    }
  }

  async function applyImage(image: UpdatableImage) {
    applyingImages.value.add(image);
    applyErrors.value = [];
    try {
      const result = await $fetch<ApplyResult>('/api/updates/apply', {
        method: 'POST',
        body: { images: [image] },
      });
      applyErrors.value = result.errors;

      if (result.orchestratorRestarting) {
        isRestarting.value = true;
        pollHealth();
      } else {
        await fetchStatus();
      }
    } catch (err: unknown) {
      applyErrors.value = [fetchErrorMessage(err, 'Update failed')];
    } finally {
      applyingImages.value.delete(image);
    }
  }

  async function pruneImages() {
    isPruning.value = true;
    lastPruneResult.value = null;
    try {
      lastPruneResult.value = await $fetch<PruneResult>('/api/updates/prune', { method: 'POST' });
      await fetchStatus();
    } catch (err: unknown) {
      applyErrors.value = [fetchErrorMessage(err, 'Prune failed')];
    } finally {
      isPruning.value = false;
    }
  }

  function pollHealth() {
    if (healthPollTimer) return;
    const maxRetries = 150; // 150 * 2s = 5 minutes
    let retries = 0;

    const tick = async () => {
      healthPollTimer = null;
      retries++;
      try {
        await $fetch('/api/health');
        // Server is back
        isRestarting.value = false;
        await fetchStatus();
        return;
      } catch {
        // Still down — give up after the retry budget is exhausted.
        if (retries >= maxRetries) {
          isRestarting.value = false;
          applyErrors.value = [...applyErrors.value, 'Server did not come back after 5 minutes'];
          return;
        }
      }
      // Schedule the next probe only after this one settled — no overlap.
      healthPollTimer = setTimeout(tick, 2000);
    };

    healthPollTimer = setTimeout(tick, 2000);
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => fetchStatus(), 60_000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (healthPollTimer) {
      clearTimeout(healthPollTimer);
      healthPollTimer = null;
    }
  }

  const updatesAvailable = computed(() => {
    if (!status.value) return 0;
    let count = 0;
    if (status.value.orchestrator?.updateAvailable) count++;
    if (status.value.worker?.updateAvailable) count++;
    if (status.value.traefik?.updateAvailable) count++;
    return count;
  });

  const isProductionMode = computed(() => status.value?.isProductionMode ?? false);

  fetchStatus();

  onMounted(() => startPolling());
  onUnmounted(() => stopPolling());

  return {
    status,
    isChecking,
    isApplying,
    isPruning,
    isRestarting,
    applyErrors,
    applyingImages,
    lastPruneResult,
    updatesAvailable,
    isProductionMode,
    checkNow,
    applyUpdates,
    applyImage,
    pruneImages,
  };
}
