<script setup lang="ts">
import type { ContainerInfo, UpdateContainerSettingsRequest, WorkerMetrics } from '~/types';

const props = defineProps<{
  container: ContainerInfo;
  isActive: boolean;
  /** Live resource metrics for this worker (polled once in the sidebar). */
  metric?: WorkerMetrics | null;
  /** A lifecycle action (stop, restart, rebuild, …) is in flight for this worker. */
  busy?: boolean;
}>();

const emit = defineEmits<{
  openTerminal: [containerId: string];
  openDesktop: [containerId: string];
  openApps: [containerId: string];
  openEditor: [containerId: string];
  stop: [id: string];
  restart: [id: string];
  rebuild: [id: string];
  remove: [id: string];
  archive: [id: string];
  update: [id: string, patch: UpdateContainerSettingsRequest, rebuild: boolean];
  downloadWorkspace: [id: string];
}>();

const toast = useToast();

const showDetail = ref(false);
const showUpload = ref(false);

// The modals mount on first open only: each one fetches environments / init
// scripts on mount, which multiplied by every card on every list refresh. They
// stay mounted afterwards so their close transition can play.
const detailMounted = ref(false);
const uploadMounted = ref(false);

function openDetail() {
  detailMounted.value = true;
  showDetail.value = true;
}

function openUpload() {
  uploadMounted.value = true;
  showUpload.value = true;
}

// Export is slow (the server materialises the bundle — incl. a docker export of
// the filesystem — before the download starts), so drive it with fetch and show
// a spinner on the button until the bundle is ready, then save it. Handled here
// (not via an anchor) precisely so the button can reflect the in-progress state.
const exporting = ref(false);
const exportLabel = computed(() => (exporting.value ? 'Preparing export…' : 'Export worker'));
async function doExport() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const res = await fetch(`/api/containers/${props.container.id}/export`);
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const filename = cd.match(/filename="?([^"]+)"?/)?.[1] || `${displayLabel.value}-worker-export.tar`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    console.error('[export] failed', err);
    toast.add({
      title: 'Export failed',
      description: err instanceof Error ? err.message : 'Could not export this worker.',
      color: 'error',
      icon: 'i-lucide-alert-circle',
    });
  } finally {
    exporting.value = false;
  }
}

const displayLabel = computed(() => props.container.displayName || shortName(props.container.id));

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

const statusColor = computed<BadgeColor>(() => {
  const colors: Record<string, BadgeColor> = {
    running: 'success',
    stopped: 'neutral',
    creating: 'warning',
    error: 'error',
    removing: 'warning',
  };
  return colors[props.container.status] || 'neutral';
});

const shortImageId = computed(() => {
  const id = props.container.imageId || '';
  const hash = id.replace('sha256:', '');
  return hash ? hash.slice(0, 10) : null;
});

const isRunning = computed(() => props.container.status === 'running');
const isStopped = computed(() => props.container.status === 'stopped');
const isTransitioning = computed(() => props.container.status === 'creating' || props.container.status === 'removing');

function metricColor(p: number) {
  return p >= 80
    ? 'text-red-500 dark:text-red-400'
    : p >= 50
      ? 'text-amber-500 dark:text-amber-400'
      : 'text-gray-500 dark:text-gray-400';
}

// Convert vertical wheel to horizontal scroll on overflowing strips (the action
// row and the metrics row) so mouse users can reach content that overflows when
// the card/sidebar is narrow.
function onHScrollWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement;
  if (el.scrollWidth <= el.clientWidth) return;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  el.scrollLeft += e.deltaY;
  e.preventDefault();
}
</script>

<template>
  <div
    class="rounded-lg p-3 border transition-colors overflow-hidden"
    :class="[
      isActive ? 'bg-blue-50/60 dark:bg-gray-800/60 border-blue-500/50 shadow-lg shadow-blue-500/10' : 'bg-gray-100/60 dark:bg-gray-800/40 border-gray-300/50 dark:border-gray-700/50',
    ]"
  >
    <!-- Name (truncated, clickable for settings) + image ID + status. The name
         shrinks so the status badge always stays in view. -->
    <div class="flex items-center gap-2 mb-2">
      <h3
        class="text-sm font-semibold text-gray-900 dark:text-white truncate min-w-0 flex-1 cursor-pointer hover:opacity-80 transition-opacity"
        :title="displayLabel"
        @click="openDetail"
      >
        {{ displayLabel }}
      </h3>
      <div class="flex items-center gap-1.5 flex-shrink-0">
        <UTooltip v-if="container.pendingRebuild" text="Settings changed — rebuild to apply">
          <UBadge color="warning" variant="subtle" size="xs">rebuild pending</UBadge>
        </UTooltip>
        <span v-if="shortImageId" class="text-[10px] text-gray-500 dark:text-gray-400 font-mono">
          {{ shortImageId }}
        </span>
        <UIcon
          v-if="busy"
          name="i-lucide-loader-circle"
          class="size-3.5 animate-spin text-gray-400"
          role="img"
          aria-label="Working"
        />
        <UBadge
          :color="statusColor"
          variant="subtle"
          size="xs"
          :icon="isTransitioning ? 'i-lucide-loader-circle' : undefined"
          :ui="{ leadingIcon: 'animate-spin' }"
        >
          {{ container.status }}
        </UBadge>
      </div>
    </div>

    <!-- Per-worker live metrics: non-wrapping, scrollable when the card is narrow -->
    <div
      v-if="isRunning && metric"
      class="card-metrics flex items-center gap-3 mb-2 text-[10px] font-mono"
      data-testid="worker-metrics"
      @wheel="onHScrollWheel"
    >
      <span
        class="flex items-center gap-1 flex-shrink-0 whitespace-nowrap"
        :class="metricColor(metric.cpuUtilization)"
        :title="`CPU ${metric.cpuUtilization.toFixed(1)}% of host`"
      >
        <UIcon name="i-lucide-cpu" class="size-3" />{{ Math.round(metric.cpuUtilization) }}%
      </span>
      <span
        class="flex items-center gap-1 flex-shrink-0 whitespace-nowrap"
        :class="metricColor(metric.memoryUtilization)"
        :title="`Memory used${metric.memoryLimitBytes ? ` of ${formatBytes(metric.memoryLimitBytes)}` : ''}`"
      >
        <UIcon name="i-lucide-memory-stick" class="size-3" />{{ formatBytes(metric.memoryUsedBytes) }}
      </span>
      <span class="flex items-center gap-1 flex-shrink-0 whitespace-nowrap text-gray-500 dark:text-gray-400" title="Disk used (container filesystem + /workspace + agent data)">
        <UIcon name="i-lucide-hard-drive" class="size-3" />{{ formatBytes(metric.diskUsedBytes) }}
      </span>
      <span class="flex items-center gap-1 flex-shrink-0 whitespace-nowrap text-gray-400 dark:text-gray-500" title="Network throughput (down / up)">
        <UIcon name="i-lucide-arrow-down" class="size-3" />{{ formatRate(metric.netRxBytesPerSec) }}
        <UIcon name="i-lucide-arrow-up" class="size-3 ml-0.5" />{{ formatRate(metric.netTxBytesPerSec) }}
      </span>
    </div>

    <!-- Actions: all left-aligned, grouped with dividers. Scrollable when narrow
         with a mouse; wraps on touch screens, where the buttons are larger. -->
    <div class="card-actions flex items-center gap-1.5 pointer-coarse:flex-wrap pointer-coarse:gap-y-2" @wheel="onHScrollWheel">
      <!-- Views (running only) -->
      <template v-if="isRunning">
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <UTooltip text="Terminal">
            <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-terminal" aria-label="Terminal" class="pointer-coarse:p-2" @click="emit('openTerminal', container.id)" />
          </UTooltip>
          <UTooltip text="Editor">
            <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-code" aria-label="Editor" class="pointer-coarse:p-2" @click="emit('openEditor', container.id)" />
          </UTooltip>
          <UTooltip text="Desktop">
            <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-monitor" aria-label="Desktop" class="pointer-coarse:p-2" @click="emit('openDesktop', container.id)" />
          </UTooltip>
          <UTooltip text="Apps">
            <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-layout-grid" aria-label="Apps" class="pointer-coarse:p-2" @click="emit('openApps', container.id)" />
          </UTooltip>
        </div>

        <span class="w-px h-4 bg-gray-300 dark:bg-gray-600 flex-shrink-0" aria-hidden="true" />

        <!-- Workspace (running only): upload, download, export -->
        <div class="flex items-center gap-0.5 flex-shrink-0">
          <UTooltip text="Upload to Workspace">
            <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-upload" aria-label="Upload to Workspace" class="pointer-coarse:p-2" @click="openUpload" />
          </UTooltip>
          <UTooltip text="Download Workspace">
            <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-download" aria-label="Download Workspace" class="pointer-coarse:p-2" @click="emit('downloadWorkspace', container.id)" />
          </UTooltip>
          <UTooltip :text="exportLabel">
            <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-package" :aria-label="exportLabel" class="pointer-coarse:p-2" :loading="exporting" :disabled="exporting" @click="doExport" />
          </UTooltip>
        </div>

        <span class="w-px h-4 bg-gray-300 dark:bg-gray-600 flex-shrink-0" aria-hidden="true" />
      </template>

      <!-- Lifecycle -->
      <div class="flex items-center gap-0.5 flex-shrink-0">
        <UTooltip text="Settings">
          <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-pencil" aria-label="Settings" class="pointer-coarse:p-2" @click="openDetail" />
        </UTooltip>
        <UTooltip v-if="isStopped" text="Restart">
          <UButton size="xs" color="success" variant="subtle" icon="i-lucide-refresh-cw" aria-label="Restart" class="pointer-coarse:p-2" @click="emit('restart', container.id)" />
        </UTooltip>
        <UTooltip v-if="isRunning" text="Stop">
          <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-square" aria-label="Stop" class="pointer-coarse:p-2" @click="emit('stop', container.id)" />
        </UTooltip>
        <UTooltip text="Rebuild">
          <UButton size="xs" color="neutral" variant="subtle" icon="i-lucide-hammer" aria-label="Rebuild" class="pointer-coarse:p-2" @click="emit('rebuild', container.id)" />
        </UTooltip>
      </div>

      <span class="w-px h-4 bg-gray-300 dark:bg-gray-600 flex-shrink-0" aria-hidden="true" />

      <!-- Destructive -->
      <div class="flex items-center gap-0.5 flex-shrink-0">
        <UTooltip text="Archive">
          <UButton size="xs" color="warning" variant="subtle" icon="i-lucide-archive" aria-label="Archive" class="pointer-coarse:p-2" @click="emit('archive', container.id)" />
        </UTooltip>
        <UTooltip text="Remove">
          <UButton size="xs" color="error" variant="subtle" icon="i-lucide-trash-2" aria-label="Remove" class="pointer-coarse:p-2" @click="emit('remove', container.id)" />
        </UTooltip>
      </div>
    </div>

    <UploadModal
      v-if="uploadMounted"
      v-model:open="showUpload"
      :container-id="container.id"
      :container-name="displayLabel"
    />

    <ContainerDetailModal
      v-if="detailMounted"
      v-model:open="showDetail"
      :container="container"
      :status-color="statusColor"
      @update="(id, patch, rebuild) => emit('update', id, patch, rebuild)"
      @rebuild="(id) => emit('rebuild', id)"
    />
  </div>
</template>

<style scoped>
/* Horizontal scroll for the metrics and action rows when they overflow a narrow
   card, with the scrollbar hidden (scroll via trackpad or wheel — see
   onHScrollWheel). */
.card-metrics,
.card-actions {
  overflow-x: auto;
  scrollbar-width: none;
}
.card-metrics::-webkit-scrollbar,
.card-actions::-webkit-scrollbar {
  display: none;
}
</style>
