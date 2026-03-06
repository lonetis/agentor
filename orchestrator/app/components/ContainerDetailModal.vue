<script setup lang="ts">
import type { ContainerInfo } from '~/types';

const props = defineProps<{
  container: ContainerInfo;
  statusColor: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';
}>();

const open = defineModel<boolean>('open', { default: false });

const shortImageId = computed(() => {
  const id = props.container.imageId || '';
  return id.replace('sha256:', '').slice(0, 12);
});

const formattedCreatedAt = computed(() => {
  if (!props.container.createdAt) return '\u2014';
  return new Date(props.container.createdAt).toLocaleString();
});

const configFields = computed(() => {
  const c = props.container;
  const fields: { key: string; value: string }[] = [];
  if (c.environmentName) fields.push({ key: 'Environment', value: c.environmentName });
  if (c.cpuLimit != null) fields.push({ key: 'CPU Limit', value: `${c.cpuLimit} cores` });
  if (c.memoryLimit) fields.push({ key: 'Memory Limit', value: c.memoryLimit });
  if (c.networkMode && c.networkMode !== 'full') fields.push({ key: 'Network Mode', value: c.networkMode });
  if (c.dockerEnabled) fields.push({ key: 'Docker Enabled', value: 'Yes' });
  return fields;
});

const repos = computed(() => props.container.repos || []);
</script>

<template>
  <UModal v-model:open="open">
    <template #content>
      <div class="p-5 max-h-[90vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white truncate mr-3">
            {{ container.displayName || shortName(container.name) }}
          </h2>
          <UBadge :color="statusColor" variant="subtle" size="sm" class="shrink-0">
            {{ container.status }}
          </UBadge>
        </div>

        <div class="space-y-5">
          <!-- Worker info -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Worker</h3>
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt class="text-gray-500 dark:text-gray-400">Container</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs">{{ shortName(container.name) }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Container ID</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs truncate" :title="container.id">{{ container.id.slice(0, 12) }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Image</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs truncate" :title="container.image">{{ container.image }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Image ID</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs truncate" :title="container.imageId">{{ shortImageId || '\u2014' }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Created</dt>
              <dd class="text-gray-900 dark:text-white text-xs">{{ formattedCreatedAt }}</dd>
            </dl>
          </section>

          <!-- Configuration -->
          <section v-if="configFields.length > 0">
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Configuration</h3>
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <template v-for="field in configFields" :key="field.key">
                <dt class="text-gray-500 dark:text-gray-400">{{ field.key }}</dt>
                <dd class="text-gray-900 dark:text-white">{{ field.value }}</dd>
              </template>
            </dl>
          </section>

          <!-- Repositories -->
          <section v-if="repos.length > 0">
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Repositories</h3>
            <div class="space-y-1">
              <div v-for="(repo, idx) in repos" :key="idx" class="text-sm">
                <span class="text-gray-900 dark:text-white font-mono text-xs">{{ repo.url }}</span>
                <span v-if="repo.branch" class="text-gray-400 ml-1.5 text-xs">@ {{ repo.branch }}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>
  </UModal>
</template>
