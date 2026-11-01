<script setup lang="ts">
import type { ContainerInfo } from '~/types';
import { useDialogLabel } from '~/composables/useDialogLabel';

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ imported: [container: ContainerInfo] }>();

const { importContainer } = useContainers();
const { titleId, content: dialogContent } = useDialogLabel();
const fileId = useId();
const nameId = useId();

const file = ref<File | null>(null);
const displayName = ref('');
const importing = ref(false);
const error = ref('');

watch(open, (isOpen) => {
  if (!isOpen) {
    file.value = null;
    displayName.value = '';
    importing.value = false;
    error.value = '';
  }
});

function close() {
  open.value = false;
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

async function doImport() {
  if (!file.value) return;
  importing.value = true;
  error.value = '';
  try {
    const container = await importContainer(file.value, displayName.value.trim() || undefined);
    emit('imported', container);
    open.value = false;
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Import failed';
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'modal-sheet' }" :content="dialogContent">
    <template #content>
      <div class="p-6 space-y-4 max-h-[90vh] overflow-y-auto modal-sheet-body">
        <h2 :id="titleId" class="text-lg font-semibold text-gray-900 dark:text-white">Import Worker</h2>
        <p class="text-xs text-gray-400 dark:text-gray-500">
          Restore a worker from an export bundle (<code class="text-gray-500 dark:text-gray-400">.tar</code>). A brand-new worker is created with its workspace, agent data, settings, and port/domain mappings restored.
        </p>

        <div class="space-y-1.5">
          <label :for="fileId" class="text-xs font-medium text-gray-600 dark:text-gray-300">Export bundle</label>
          <input
            :id="fileId"
            type="file"
            accept=".tar,application/x-tar,application/octet-stream"
            data-testid="import-file"
            class="block w-full text-xs text-gray-600 dark:text-gray-300 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 dark:file:bg-gray-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 dark:file:text-gray-200 hover:file:bg-gray-200 dark:hover:file:bg-gray-700 cursor-pointer"
            @change="onFileChange"
          >
          <p v-if="file" class="text-[11px] text-gray-500 dark:text-gray-400">{{ file.name }} ({{ formatBytes(file.size) }})</p>
        </div>

        <div class="space-y-1.5">
          <label :for="nameId" class="text-xs font-medium text-gray-600 dark:text-gray-300">
            Display name <span class="text-gray-400">(optional)</span>
          </label>
          <UInput :id="nameId" v-model="displayName" size="sm" class="w-full" placeholder="Defaults to the exported worker's name" data-testid="import-name" />
        </div>

        <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400" data-testid="import-error">{{ error }}</p>

        <div class="flex flex-wrap gap-3 pt-2 modal-sheet-footer">
          <UButton class="flex-1" :loading="importing" :disabled="!file" data-testid="import-submit" @click="doImport">
            Import
          </UButton>
          <UButton color="neutral" variant="outline" @click="close">Cancel</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
