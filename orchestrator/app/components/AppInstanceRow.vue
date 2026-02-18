<script setup lang="ts">
import type { AppInstanceInfo, AppTypeInfo } from '~/types';

const props = defineProps<{
  instance: AppInstanceInfo;
  appType?: AppTypeInfo;
  containerName?: string;
}>();

const emit = defineEmits<{
  stop: [appType: string, id: string];
}>();

const portLabel = computed(() => {
  if (!props.appType) return `:${props.instance.port}`;
  const portDef = props.appType.ports[0];
  return portDef ? `${portDef.name} :${props.instance.port}` : `:${props.instance.port}`;
});

const portTooltip = computed(() => {
  const base = `Port ${props.instance.port}`;
  const network = props.containerName ? ` — accessible at ${props.containerName}:${props.instance.port}` : '';
  return base + network;
});
</script>

<template>
  <div class="flex items-center justify-between px-3 py-1.5 text-xs border-b border-gray-200 dark:border-gray-800 last:border-0">
    <div class="flex items-center gap-2 min-w-0">
      <span
        class="w-1.5 h-1.5 rounded-full flex-shrink-0"
        :class="instance.status === 'running' ? 'bg-green-500' : 'bg-gray-500'"
      />
      <span class="text-gray-700 dark:text-gray-300 font-mono truncate">{{ instance.id }}</span>
      <span class="text-gray-400 dark:text-gray-500 flex-shrink-0" :title="portTooltip">
        {{ portLabel }}
      </span>
    </div>
    <div class="flex items-center gap-1 flex-shrink-0">
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        @click="emit('stop', instance.appType, instance.id)"
      >
        Stop
      </UButton>
    </div>
  </div>
</template>
