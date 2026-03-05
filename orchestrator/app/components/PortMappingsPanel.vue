<script setup lang="ts">
import type { ContainerInfo } from '~/types';

const props = defineProps<{
  containers: ContainerInfo[];
}>();

const { mappings, createMapping, removeMapping } = usePortMappings();

const showForm = ref(false);
const formType = ref<'localhost' | 'external'>('localhost');
const formExternalPort = ref<number | undefined>();
const formWorkerId = ref('');
const formInternalPort = ref<number | undefined>();

const runningContainers = computed(() =>
  props.containers.filter((c) => c.status === 'running')
);

function resetForm() {
  formType.value = 'localhost';
  formExternalPort.value = undefined;
  formWorkerId.value = '';
  formInternalPort.value = undefined;
  showForm.value = false;
}

async function handleCreate() {
  if (!formExternalPort.value || !formWorkerId.value || !formInternalPort.value) return;
  await createMapping({
    externalPort: formExternalPort.value,
    type: formType.value,
    workerId: formWorkerId.value,
    internalPort: formInternalPort.value,
  });
  resetForm();
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Add mapping form -->
    <div v-if="showForm" class="flex flex-col gap-1.5 bg-gray-100 dark:bg-gray-800 rounded p-2 text-xs">
      <div class="flex gap-1.5">
        <select
          v-model="formType"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs shrink-0"
        >
          <option value="localhost">local</option>
          <option value="external">ext</option>
        </select>
        <select
          v-model="formWorkerId"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        >
          <option value="" disabled>Worker</option>
          <option v-for="c in runningContainers" :key="c.id" :value="c.id">
            {{ c.displayName || shortName(c.name) }}
          </option>
        </select>
      </div>
      <div class="flex gap-1.5 items-center">
        <input
          v-model.number="formExternalPort"
          type="number"
          placeholder="Ext port"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        />
        <span class="text-gray-400 dark:text-gray-600 shrink-0">&rarr;</span>
        <input
          v-model.number="formInternalPort"
          type="number"
          placeholder="Int port"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        />
        <UButton size="xs" color="primary" variant="solid" class="shrink-0" @click="handleCreate">
          Add
        </UButton>
      </div>
      <UButton size="xs" color="neutral" variant="ghost" class="self-end" @click="showForm = false">
        Cancel
      </UButton>
    </div>

    <UButton v-if="!showForm" size="xs" color="primary" variant="solid" class="self-start" @click="showForm = true">
      + Map
    </UButton>

    <!-- Mappings list -->
    <div v-if="mappings.length === 0 && !showForm" class="text-gray-400 dark:text-gray-500 text-xs text-center py-1">
      No active mappings
    </div>
    <div
      v-for="m in mappings"
      :key="m.externalPort"
      class="flex items-center gap-1.5 text-xs bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 min-w-0"
    >
      <span
        class="px-1 rounded text-[10px] font-medium shrink-0"
        :class="m.type === 'localhost' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300'"
      >
        {{ m.type === 'localhost' ? 'local' : 'ext' }}
      </span>
      <span class="text-gray-700 dark:text-gray-300 font-mono shrink-0">:{{ m.externalPort }}</span>
      <span class="text-gray-400 dark:text-gray-600 shrink-0">&rarr;</span>
      <span class="text-gray-500 dark:text-gray-400 truncate min-w-0 flex-1">{{ shortName(m.workerName) }}:{{ m.internalPort }}</span>
      <button
        class="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors shrink-0 p-0.5"
        title="Remove mapping"
        @click="removeMapping(m.externalPort)"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
