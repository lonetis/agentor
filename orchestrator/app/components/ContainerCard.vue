<script setup lang="ts">
import type { ContainerInfo } from '~/types';

const props = defineProps<{
  container: ContainerInfo;
  isActive: boolean;
}>();

const emit = defineEmits<{
  openTerminal: [containerId: string];
  openDesktop: [containerId: string];
  openApps: [containerId: string];
  openEditor: [containerId: string];
  stop: [id: string];
  restart: [id: string];
  remove: [id: string];
  archive: [id: string];
  downloadWorkspace: [id: string];
}>();

const showDetail = ref(false);
const showUpload = ref(false);

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

</script>

<template>
  <div
    class="rounded-lg p-3 border transition-colors overflow-hidden"
    :class="[
      isActive ? 'bg-blue-50/60 dark:bg-gray-800/60 border-blue-500/50 shadow-lg shadow-blue-500/10' : 'bg-gray-100/60 dark:bg-gray-800/40 border-gray-300/50 dark:border-gray-700/50',
    ]"
  >
    <!-- Name + status + image ID (clickable for details) -->
    <div class="cursor-pointer hover:opacity-80 transition-opacity mb-2" @click="showDetail = true">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white truncate" :title="container.displayName || shortName(container.name)">
          {{ container.displayName || shortName(container.name) }}
        </h3>
        <div class="flex items-center gap-1.5 shrink-0 ml-2">
          <span v-if="shortImageId" class="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
            {{ shortImageId }}
          </span>
          <UBadge :color="statusColor" variant="subtle" size="xs">
            {{ container.status }}
          </UBadge>
        </div>
      </div>
    </div>

    <!-- All buttons in one row -->
    <div class="flex items-center flex-wrap gap-1.5">
      <template v-if="isRunning">
        <UTooltip text="Terminal">
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            @click="emit('openTerminal', container.id)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </UButton>
        </UTooltip>
        <UTooltip text="Desktop">
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            @click="emit('openDesktop', container.id)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </UButton>
        </UTooltip>
        <UTooltip text="Editor">
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            @click="emit('openEditor', container.id)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
            </svg>
          </UButton>
        </UTooltip>
        <UTooltip text="Apps">
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            @click="emit('openApps', container.id)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </UButton>
        </UTooltip>
        <UTooltip text="Upload to Workspace">
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            @click="showUpload = true"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </UButton>
        </UTooltip>
        <UTooltip text="Download Workspace">
          <UButton
            size="xs"
            color="neutral"
            variant="subtle"
            @click="emit('downloadWorkspace', container.id)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </UButton>
        </UTooltip>
      </template>

      <div class="flex-1" />

      <UTooltip v-if="container.status === 'stopped'" text="Restart">
        <UButton
          size="xs"
          color="success"
          variant="subtle"
          @click="emit('restart', container.id)"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </UButton>
      </UTooltip>
      <UTooltip v-if="isRunning" text="Stop">
        <UButton
          size="xs"
          color="neutral"
          variant="subtle"
          @click="emit('stop', container.id)"
        >
          <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        </UButton>
      </UTooltip>
      <UTooltip text="Archive">
        <UButton
          size="xs"
          color="warning"
          variant="subtle"
          @click="emit('archive', container.id)"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
        </UButton>
      </UTooltip>
      <UTooltip text="Remove">
        <UButton
          size="xs"
          color="error"
          variant="subtle"
          @click="emit('remove', container.id)"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </UButton>
      </UTooltip>
    </div>

    <UploadModal
      v-model:open="showUpload"
      :container-id="container.id"
      :container-name="container.displayName || shortName(container.name)"
    />

    <ContainerDetailModal
      v-model:open="showDetail"
      :container="container"
      :status-color="statusColor"
    />
  </div>
</template>
