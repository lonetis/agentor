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
  openVsCode: [containerId: string];
  stop: [id: string];
  restart: [id: string];
  rebuild: [id: string];
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
        <!-- Views: terminal, desktop, apps -->
        <div class="flex items-center gap-0.5">
          <UTooltip text="Terminal">
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-terminal"
              @click="emit('openTerminal', container.id)"
            />
          </UTooltip>
          <UTooltip text="Desktop">
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-monitor"
              @click="emit('openDesktop', container.id)"
            />
          </UTooltip>
          <UTooltip text="Apps">
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-layout-grid"
              @click="emit('openApps', container.id)"
            />
          </UTooltip>
        </div>

        <span class="w-px h-4 bg-gray-300 dark:bg-gray-600" />

        <!-- Editors -->
        <div class="flex items-center gap-0.5">
          <UTooltip text="Editor">
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-code"
              @click="emit('openEditor', container.id)"
            />
          </UTooltip>
          <UTooltip text="VS Code Tunnel">
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-radio-tower"
              @click="emit('openVsCode', container.id)"
            />
          </UTooltip>
        </div>

        <span class="w-px h-4 bg-gray-300 dark:bg-gray-600" />

        <!-- Workspace -->
        <div class="flex items-center gap-0.5">
          <UTooltip text="Upload to Workspace">
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-upload"
              @click="showUpload = true"
            />
          </UTooltip>
          <UTooltip text="Download Workspace">
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-download"
              @click="emit('downloadWorkspace', container.id)"
            />
          </UTooltip>
        </div>
      </template>

      <div class="flex-1" />

      <UTooltip v-if="container.status === 'stopped'" text="Restart">
        <UButton
          size="xs"
          color="success"
          variant="subtle"
          icon="i-lucide-refresh-cw"
          @click="emit('restart', container.id)"
        />
      </UTooltip>
      <UTooltip v-if="isRunning" text="Stop">
        <UButton
          size="xs"
          color="neutral"
          variant="subtle"
          icon="i-lucide-square"
          @click="emit('stop', container.id)"
        />
      </UTooltip>
      <UTooltip text="Rebuild">
        <UButton
          size="xs"
          color="info"
          variant="subtle"
          icon="i-lucide-hammer"
          @click="emit('rebuild', container.id)"
        />
      </UTooltip>
      <UTooltip text="Archive">
        <UButton
          size="xs"
          color="warning"
          variant="subtle"
          icon="i-lucide-archive"
          @click="emit('archive', container.id)"
        />
      </UTooltip>
      <UTooltip text="Remove">
        <UButton
          size="xs"
          color="error"
          variant="subtle"
          icon="i-lucide-trash-2"
          @click="emit('remove', container.id)"
        />
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
