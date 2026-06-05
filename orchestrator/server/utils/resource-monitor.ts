import type { DockerService, RawContainerStats } from './docker';
import type { ContainerManager } from './container';
import type { WorkerMetrics, WorkerMetricsStatus } from '../../shared/types';

/** How often per-worker cpu/mem/net is sampled via the Docker stats API. Short
 * so the dashboard feels live; an overlap guard keeps a slow sample from
 * stacking the next tick. Network rates are derived from consecutive samples. */
const POLL_INTERVAL_MS = 3_000;

/** Per-worker disk usage (writable layer + volumes) is comparatively expensive
 * and slow-changing, so it samples on a much slower cadence. */
const DISK_POLL_INTERVAL_MS = 60_000;

interface WorkerSample {
  rx: number;
  tx: number;
  blkRead: number;
  blkWrite: number;
  t: number;
}

/**
 * Polls per-worker resource metrics entirely through the Docker API — cpu /
 * memory / network via `container.stats`, and disk via the container's writable
 * layer size (`SizeRw`) plus a `du` of its volumes. This is OS- and
 * runtime-independent (no host `/proc`/`statfs`), so it behaves the same on
 * Docker Desktop, Linux, etc. Keeps the latest snapshot in memory only —
 * metrics are ephemeral, so nothing is persisted.
 */
export class ResourceMonitor {
  /** Latest per-worker metrics, keyed by the stable container name. */
  private workers = new Map<string, WorkerMetrics>();
  private prevWorker = new Map<string, WorkerSample>();
  /** Last-sampled per-worker disk usage (bytes), keyed by container name. */
  private workerDisk = new Map<string, number>();

  private pollInterval?: ReturnType<typeof setInterval>;
  private diskInterval?: ReturnType<typeof setInterval>;
  /** Guards against overlapping samples when a poll runs longer than the interval. */
  private polling = false;
  private diskPolling = false;

  constructor(
    private docker: DockerService,
    private containers: ContainerManager,
  ) {}

  async init(): Promise<void> {
    await this.poll();
    this.pollInterval = setInterval(() => {
      this.poll().catch((err) => {
        useLogger().error(`[resource-monitor] poll error: ${err instanceof Error ? err.message : err}`);
      });
    }, POLL_INTERVAL_MS);

    // Disk on a slower cadence (du + SizeRw are comparatively expensive).
    this.sampleWorkerDisk().catch(() => {});
    this.diskInterval = setInterval(() => {
      this.pollWorkerDisk().catch((err) => {
        useLogger().error(`[resource-monitor] disk poll error: ${err instanceof Error ? err.message : err}`);
      });
    }, DISK_POLL_INTERVAL_MS);

    // Don't keep the event loop alive solely for metrics polling.
    if (typeof this.pollInterval.unref === 'function') this.pollInterval.unref();
    if (typeof this.diskInterval.unref === 'function') this.diskInterval.unref();
    useLogger().info('[resource-monitor] started');
  }

  getWorkerMetricsStatus(): WorkerMetricsStatus {
    return { workers: Array.from(this.workers.values()).map((m) => this.withLatestDisk(m)) };
  }

  /** Per-worker metrics for one worker, by its UUID `id`. */
  getWorkerMetric(workerId: string): WorkerMetrics | undefined {
    for (const m of this.workers.values()) {
      if (m.workerId === workerId) return this.withLatestDisk(m);
    }
    return undefined;
  }

  /** Overlay the latest disk sample (from the slower disk poll) onto a snapshot
   * produced by the fast cpu/mem/net poll, so disk is never stale relative to
   * its own cadence. */
  private withLatestDisk(m: WorkerMetrics): WorkerMetrics {
    const disk = this.workerDisk.get(m.containerName);
    return disk === undefined ? m : { ...m, diskUsedBytes: disk };
  }

  /** Force an immediate re-sample (used by the manual refresh endpoint) of
   * per-worker cpu/mem/net AND disk. Bypasses the interval overlap guards so a
   * manual refresh reliably samples even when a scheduled poll is mid-flight
   * (otherwise a just-created worker can be missing from the snapshot). */
  async refresh(): Promise<void> {
    await Promise.all([this.pollWorkers(), this.sampleWorkerDisk()]);
  }

  /** Guarded wrapper for the interval — skips if a sample is already running. */
  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.pollWorkers();
    } finally {
      this.polling = false;
    }
  }

  private async pollWorkers(): Promise<void> {
    const running = this.containers.list().filter((c) => c.status === 'running');
    const runningNames = new Set(running.map((c) => c.containerName));

    // Drop metrics + samples for workers that are no longer running.
    for (const name of [...this.workers.keys()]) {
      if (!runningNames.has(name)) this.workers.delete(name);
    }
    for (const name of [...this.prevWorker.keys()]) {
      if (!runningNames.has(name)) this.prevWorker.delete(name);
    }

    await Promise.all(
      running.map(async (c) => {
        const now = new Date().toISOString();
        try {
          const stats = await this.docker.getContainerStats(c.containerId);
          this.workers.set(c.containerName, this.computeWorkerMetrics(c, stats, now));
        } catch (err) {
          this.workers.set(c.containerName, {
            workerId: c.id,
            containerName: c.containerName,
            displayName: c.displayName,
            status: c.status,
            cpuUtilization: 0,
            memoryUsedBytes: 0,
            memoryLimitBytes: 0,
            memoryUtilization: 0,
            diskUsedBytes: this.workerDisk.get(c.containerName) ?? 0,
            netRxBytesPerSec: 0,
            netTxBytesPerSec: 0,
            blkReadBytesPerSec: 0,
            blkWriteBytesPerSec: 0,
            lastChecked: now,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  private computeWorkerMetrics(
    c: { id: string; containerName: string; displayName: string; status: WorkerMetrics['status'] },
    stats: RawContainerStats,
    now: string,
  ): WorkerMetrics {
    // CPU% as a fraction of total host capacity (0-100). `system_cpu_usage`
    // counts jiffies across every core, so cpuDelta/systemDelta is the share of
    // the whole machine — already 0-1 without multiplying by core count.
    let cpuUtilization = 0;
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = (stats.cpu_stats.system_cpu_usage ?? 0) - (stats.precpu_stats.system_cpu_usage ?? 0);
    if (cpuDelta > 0 && systemDelta > 0) {
      cpuUtilization = this.clampPct((cpuDelta / systemDelta) * 100);
    }

    // Memory — subtract inactive_file/cache to match `docker stats` "real" usage.
    const rawUsage = stats.memory_stats.usage ?? 0;
    const inactive = stats.memory_stats.stats?.inactive_file ?? stats.memory_stats.stats?.cache ?? 0;
    const memoryUsedBytes = Math.max(0, rawUsage - inactive);
    const memoryLimitBytes = stats.memory_stats.limit ?? 0;
    const memoryUtilization = memoryLimitBytes > 0 ? this.clampPct((memoryUsedBytes / memoryLimitBytes) * 100) : 0;

    // Network + block IO — derive a per-second rate from the previous sample.
    let rx = 0;
    let tx = 0;
    for (const net of Object.values(stats.networks ?? {})) {
      rx += net.rx_bytes ?? 0;
      tx += net.tx_bytes ?? 0;
    }
    let blkRead = 0;
    let blkWrite = 0;
    for (const e of stats.blkio_stats?.io_service_bytes_recursive ?? []) {
      if (e.op.toLowerCase() === 'read') blkRead += e.value;
      else if (e.op.toLowerCase() === 'write') blkWrite += e.value;
    }

    const t = Date.now();
    const prev = this.prevWorker.get(c.containerName);
    this.prevWorker.set(c.containerName, { rx, tx, blkRead, blkWrite, t });

    let netRxBytesPerSec = 0;
    let netTxBytesPerSec = 0;
    let blkReadBytesPerSec = 0;
    let blkWriteBytesPerSec = 0;
    if (prev) {
      const dt = (t - prev.t) / 1000;
      if (dt > 0) {
        netRxBytesPerSec = Math.max(0, (rx - prev.rx) / dt);
        netTxBytesPerSec = Math.max(0, (tx - prev.tx) / dt);
        blkReadBytesPerSec = Math.max(0, (blkRead - prev.blkRead) / dt);
        blkWriteBytesPerSec = Math.max(0, (blkWrite - prev.blkWrite) / dt);
      }
    }

    return {
      workerId: c.id,
      containerName: c.containerName,
      displayName: c.displayName,
      status: c.status,
      cpuUtilization,
      memoryUsedBytes,
      memoryLimitBytes,
      memoryUtilization,
      diskUsedBytes: this.workerDisk.get(c.containerName) ?? 0,
      netRxBytesPerSec,
      netTxBytesPerSec,
      blkReadBytesPerSec,
      blkWriteBytesPerSec,
      lastChecked: now,
    };
  }

  // --- Per-worker disk usage (slow poll) ---

  /** Guarded wrapper for the interval — skips if a sample is already running so
   * a slow `du` can't stack the next tick. */
  private async pollWorkerDisk(): Promise<void> {
    if (this.diskPolling) return;
    this.diskPolling = true;
    try {
      await this.sampleWorkerDisk();
    } finally {
      this.diskPolling = false;
    }
  }

  /** The actual disk sample — unguarded, so `refresh()` always runs it. */
  private async sampleWorkerDisk(): Promise<void> {
    const running = this.containers.list().filter((c) => c.status === 'running');
    const names = new Set(running.map((c) => c.containerName));
    for (const name of [...this.workerDisk.keys()]) {
      if (!names.has(name)) this.workerDisk.delete(name);
    }
    await Promise.all(
      running.map(async (c) => {
        try {
          const bytes = await this.docker.getWorkerDiskUsageBytes(c.containerId);
          this.workerDisk.set(c.containerName, bytes);
        } catch {
          // Keep the last known value on a transient failure.
        }
      }),
    );
  }

  private clampPct(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, n));
  }
}
