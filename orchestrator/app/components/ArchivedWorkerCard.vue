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
        <UButton size="xs" color="primary" variant="subtle" @click="emit('unarchive', worker.name)">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4l3-3m0 0l3 3m-3-3v6" />
          </svg>
        </UButton>
      </UTooltip>
      <UTooltip text="Delete">
        <UButton size="xs" color="error" variant="subtle" @click="emit('delete', worker.name)">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </UButton>
      </UTooltip>
    </div>
  </div>
</template>
