<script setup lang="ts">
import type { ArchivedWorker } from '~/types';

const props = defineProps<{
  worker: ArchivedWorker;
}>();

const emit = defineEmits<{
  unarchive: [name: string];
  delete: [name: string];
}>();

const formattedDate = computed(() => {
  const d = new Date(props.worker.archivedAt || props.worker.createdAt);
  return d.toLocaleDateString();
});
</script>

<template>
  <div class="rounded-lg px-2.5 py-1.5 bg-gray-100/40 dark:bg-gray-800/30 border border-gray-200/50 dark:border-gray-700/30 flex items-center gap-2">
    <div class="min-w-0 flex-1">
      <h3 class="text-xs font-medium text-gray-500 dark:text-gray-400 truncate" :title="worker.displayName || shortName(worker.name)">
        {{ worker.displayName || shortName(worker.name) }}
      </h3>
      <p class="text-[10px] text-gray-400 dark:text-gray-600 leading-tight">{{ formattedDate }}</p>
    </div>
    <div class="flex items-center gap-1 shrink-0">
      <UTooltip text="Unarchive">
        <UButton size="xs" color="primary" variant="subtle" icon="i-lucide-archive-restore" @click="emit('unarchive', worker.name)" />
      </UTooltip>
      <UTooltip text="Delete">
        <UButton size="xs" color="error" variant="subtle" icon="i-lucide-trash-2" @click="emit('delete', worker.name)" />
      </UTooltip>
    </div>
  </div>
</template>
