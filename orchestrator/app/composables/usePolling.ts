export function usePolling(callback: () => void, intervalMs: number) {
  let timer: ReturnType<typeof setInterval> | null = null;

  function start() {
    if (!timer) timer = setInterval(callback, intervalMs);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  onMounted(start);
  onUnmounted(stop);

  return { start, stop };
}
