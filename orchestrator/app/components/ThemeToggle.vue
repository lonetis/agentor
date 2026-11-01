<script setup lang="ts">
const colorMode = useColorMode();

const modes = [
  { value: 'system', icon: 'i-lucide-monitor', label: 'Default' },
  { value: 'light', icon: 'i-lucide-sun', label: 'White' },
  { value: 'dark', icon: 'i-lucide-moon', label: 'Dark' },
] as const;
</script>

<template>
  <div data-theme-toggle class="flex items-center rounded-md bg-gray-200 dark:bg-gray-800 p-0.5">
    <UTooltip v-for="mode in modes" :key="mode.value" :text="mode.label">
      <button
        type="button"
        class="p-1 rounded transition-colors pointer-coarse:p-2"
        :class="colorMode.preference === mode.value
          ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
          : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'"
        :aria-label="`${mode.label} theme`"
        :aria-pressed="colorMode.preference === mode.value"
        @click="colorMode.preference = mode.value"
      >
        <UIcon :name="mode.icon" class="size-3.5" />
      </button>
    </UTooltip>
  </div>
</template>
