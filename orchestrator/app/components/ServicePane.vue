<script setup lang="ts">
const props = defineProps<{
  containerId: string;
  endpoint: 'desktop' | 'editor';
  label: string;
  icon: string;
  url: string;
}>();

const containerIdRef = toRef(props, 'containerId');
const { status } = useContainerServiceStatus(containerIdRef as Ref<string>, props.endpoint);
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Not running / starting -->
    <div v-if="!status.running" class="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-4">
      <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          :d="icon"
        />
      </svg>
      <p class="text-sm">{{ label }} is starting...</p>
    </div>

    <!-- Running -->
    <template v-else>
      <div class="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700">
        <span class="text-xs text-green-400 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          {{ label }} running
        </span>
        <UButton
          size="xs"
          color="neutral"
          variant="solid"
          :to="url"
          target="_blank"
          external
        >
          Open in tab
        </UButton>
      </div>

      <iframe
        :src="url"
        class="flex-1 w-full border-0"
        allow="clipboard-read; clipboard-write"
      />
    </template>
  </div>
</template>
