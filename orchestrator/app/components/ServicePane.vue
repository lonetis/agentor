<script setup lang="ts">
const props = defineProps<{
  containerId: string;
  endpoint: 'desktop' | 'editor';
  label: string;
  iconName: string;
  url: string;
}>();

const containerIdRef = toRef(props, 'containerId');
const { status } = useContainerServiceStatus(containerIdRef as Ref<string>, props.endpoint);

// iOS home-screen apps keep their own cookie jar, so a new tab would open the
// service unauthenticated there.
const canOpenInTab = (navigator as Navigator & { standalone?: boolean }).standalone !== true;
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Not running / starting -->
    <div v-if="!status.running" class="flex flex-col items-center justify-center h-full gap-4 bg-(--terminal-bg) text-gray-500 dark:text-gray-400">
      <UIcon :name="iconName" class="size-12" />
      <p class="flex items-center gap-2 text-sm">
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        {{ label }} is starting...
      </p>
    </div>

    <!-- Running -->
    <template v-else>
      <div class="flex items-center justify-between h-[30px] px-2 border-b bg-(--terminal-bar-bg) border-(--terminal-bar-border)">
        <span class="text-xs text-green-700 dark:text-green-400 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-green-500 motion-safe:animate-pulse" />
          {{ label }} running
        </span>
        <UButton
          v-if="canOpenInTab"
          size="xs"
          color="neutral"
          variant="ghost"
          trailing-icon="i-lucide-external-link"
          :to="url"
          target="_blank"
          external
        >
          Open in tab
        </UButton>
      </div>

      <iframe
        :src="url"
        :title="`${label} for this worker`"
        class="flex-1 min-h-0 w-full border-0"
        allow="clipboard-read; clipboard-write; fullscreen"
        allowfullscreen
      />
    </template>
  </div>
</template>
