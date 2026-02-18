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
  <div class="rounded-lg p-2.5 bg-gray-100/40 dark:bg-gray-800/30 border border-gray-200/50 dark:border-gray-700/30">
    <div class="flex items-center justify-between mb-1">
      <h3 class="text-xs font-medium text-gray-500 dark:text-gray-400 truncate" :title="worker.displayName || worker.name">
        {{ worker.displayName || worker.name }}
      </h3>
    </div>
    <p class="text-[10px] text-gray-400 dark:text-gray-600 mb-2">Archived {{ formattedDate }}</p>
    <div class="flex items-center gap-1.5">
      <UButton size="xs" color="primary" variant="subtle" @click="emit('unarchive', worker.name)">
        Unarchive
      </UButton>
      <div class="flex-1" />
      <UButton size="xs" color="error" variant="subtle" @click="emit('delete', worker.name)">
        Delete
      </UButton>
    </div>
  </div>
</template>
