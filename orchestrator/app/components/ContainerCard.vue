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
  rebuild: [id: string];
  remove: [id: string];
  archive: [id: string];
  rename: [id: string, displayName: string];
  downloadWorkspace: [id: string];
}>();

const showDetail = ref(false);
const showUpload = ref(false);

const displayLabel = computed(() => props.container.displayName || shortName(props.container.name));

// Inline rename (mirrors the tmux tab rename interaction).
const renaming = ref(false);
const renameValue = ref('');
const renameInput = ref<HTMLInputElement | null>(null);

async function startRename() {
  renameValue.value = displayLabel.value;
  renaming.value = true;
  await nextTick();
  renameInput.value?.focus();
  renameInput.value?.select();
}

function cancelRename() {
  renaming.value = false;
}

function commitRename() {
  if (!renaming.value) return;
  renaming.value = false;
  const next = renameValue.value.trim();
  if (next && next !== displayLabel.value) {
    emit('rename', props.container.id, next);
  }
}

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
    <div class="mb-2">
      <div class="flex items-center justify-between gap-2">
        <input
          v-if="renaming"
          ref="renameInput"
          v-model="renameValue"
          class="min-w-0 flex-1 text-sm font-semibold bg-white dark:bg-gray-900 text-gray-900 dark:text-white border border-blue-500/60 rounded px-1.5 py-0.5 focus:outline-none"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
          @click.stop
        />
        <h3
          v-else
          class="text-sm font-semibold text-gray-900 dark:text-white truncate cursor-pointer hover:opacity-80 transition-opacity"
          :title="displayLabel"
          @click="showDetail = true"
        >
          {{ displayLabel }}
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
        <!-- Views: terminal, editor, desktop, apps -->
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
          <UTooltip text="Editor">
            <UButton
              size="xs"
              color="neutral"
              variant="subtle"
              icon="i-lucide-code"
              @click="emit('openEditor', container.id)"
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

      <UTooltip text="Rename">
        <UButton
          size="xs"
          color="neutral"
          variant="subtle"
          icon="i-lucide-pencil"
          @click="startRename"
        />
      </UTooltip>
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
      :container-name="displayLabel"
    />

    <ContainerDetailModal
      v-model:open="showDetail"
      :container="container"
      :status-color="statusColor"
      @rename="(id, dn) => emit('rename', id, dn)"
    />
  </div>
</template>
