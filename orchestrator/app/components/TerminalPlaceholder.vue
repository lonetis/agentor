<script setup lang="ts">
// Same state as the dashboard's "+ New Worker" button (pages/index.vue).
const createOpen = useState<boolean>('create-worker-modal-open', () => false);
</script>

<template>
  <div
    class="flex items-center justify-center h-full p-4 text-gray-500 dark:text-gray-400"
    style="background: var(--terminal-bg)"
  >
    <div class="text-center">
      <UIcon name="i-lucide-terminal" class="size-16 mx-auto mb-4 opacity-30" />
      <p class="text-sm">Create a worker from the sidebar to get started</p>
      <UButton class="mt-4" icon="i-lucide-plus" @click="() => { createOpen = true }">Create worker</UButton>
    </div>
  </div>
</template>
