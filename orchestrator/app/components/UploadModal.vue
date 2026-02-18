<script setup lang="ts">
const props = defineProps<{
  containerId: string;
  containerName: string;
}>();

const open = defineModel<boolean>('open', { default: false });

const files = ref<File[]>([]);
const isUploading = ref(false);

watch(open, (isOpen) => {
  if (!isOpen) {
    files.value = [];
  }
});

async function upload() {
  if (files.value.length === 0) return;

  isUploading.value = true;
  try {
    const formData = new FormData();
    for (const file of files.value) {
      formData.append('files', file, file.name);
    }
    await $fetch(`/api/containers/${props.containerId}/workspace`, {
      method: 'POST',
      body: formData,
    });
    open.value = false;
  } finally {
    isUploading.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="open">
    <template #content>
      <div class="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
          Upload to Workspace
        </h2>
        <p class="text-xs text-gray-400 dark:text-gray-500">
          Files will be uploaded to <code class="text-gray-500 dark:text-gray-400">/workspace</code> in {{ containerName }}
        </p>

        <FileDropZone v-model="files" />

        <div class="flex gap-3 pt-2">
          <UButton
            class="flex-1"
            :loading="isUploading"
            :disabled="files.length === 0"
            @click="upload"
          >
            Upload {{ files.length > 0 ? `(${files.length} file${files.length !== 1 ? 's' : ''})` : '' }}
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            @click="open = false"
          >
            Cancel
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
