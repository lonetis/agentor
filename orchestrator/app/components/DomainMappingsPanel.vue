<script setup lang="ts">
import type { ContainerInfo } from '~/types';

const props = defineProps<{
  containers: ContainerInfo[];
}>();

const { mappings, status, createMapping, removeMapping } = useDomainMappings();

const showForm = ref(false);
const formSubdomain = ref('');
const formProtocol = ref<'http' | 'https' | 'tcp'>('http');
const formWorkerId = ref('');
const formInternalPort = ref<number | undefined>();
const formBaseDomain = ref('');
const formAuthEnabled = ref(false);
const formAuthUsername = ref('');
const formAuthPassword = ref('');

const multiDomain = computed(() => status.value.baseDomains.length > 1);

watch(() => status.value.baseDomains, (domains) => {
  if (!formBaseDomain.value && domains.length > 0) {
    formBaseDomain.value = domains[0]!;
  }
}, { immediate: true });

const runningContainers = computed(() =>
  props.containers.filter((c) => c.status === 'running')
);

function resetForm() {
  formSubdomain.value = '';
  formBaseDomain.value = status.value.baseDomains[0] || '';
  formProtocol.value = 'http';
  formWorkerId.value = '';
  formInternalPort.value = undefined;
  formAuthEnabled.value = false;
  formAuthUsername.value = '';
  formAuthPassword.value = '';
  showForm.value = false;
}

async function handleCreate() {
  if (!formSubdomain.value || !formWorkerId.value || !formInternalPort.value || !formBaseDomain.value) return;
  await createMapping({
    subdomain: formSubdomain.value,
    baseDomain: formBaseDomain.value,
    protocol: formProtocol.value,
    workerId: formWorkerId.value,
    internalPort: formInternalPort.value,
    ...(formAuthEnabled.value && formAuthUsername.value && formAuthPassword.value
      ? { basicAuth: { username: formAuthUsername.value, password: formAuthPassword.value } }
      : {}),
  });
  resetForm();
}

const protocolColors: Record<string, string> = {
  http: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300',
  https: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300',
  tcp: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300',
};
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Add mapping form -->
    <div v-if="showForm" class="flex flex-col gap-1.5 bg-gray-100 dark:bg-gray-800 rounded p-2 text-xs">
      <div class="flex gap-1.5">
        <select
          v-model="formProtocol"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs shrink-0"
        >
          <option value="http">http</option>
          <option value="https">https</option>
          <option value="tcp">tcp</option>
        </select>
        <select
          v-model="formWorkerId"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        >
          <option value="" disabled>Worker</option>
          <option v-for="c in runningContainers" :key="c.id" :value="c.id">
            {{ c.displayName || c.name }}
          </option>
        </select>
      </div>
      <div class="flex gap-1.5 items-center">
        <input
          v-model="formSubdomain"
          type="text"
          placeholder="subdomain"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        />
        <select
          v-if="multiDomain"
          v-model="formBaseDomain"
          class="bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 rounded px-1 py-1 text-[10px] shrink-0"
        >
          <option v-for="d in status.baseDomains" :key="d" :value="d">.{{ d }}</option>
        </select>
        <span v-else class="text-gray-400 dark:text-gray-500 text-[10px] shrink-0">.{{ status.baseDomains[0] }}</span>
      </div>
      <div class="flex gap-1.5 items-center">
        <input
          v-model.number="formInternalPort"
          type="number"
          placeholder="Internal port"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        />
      </div>
      <div v-if="formProtocol !== 'tcp'" class="flex flex-col gap-1.5">
        <label class="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 cursor-pointer">
          <input
            v-model="formAuthEnabled"
            type="checkbox"
            class="rounded"
          />
          Basic auth
        </label>
        <div v-if="formAuthEnabled" class="flex gap-1.5">
          <input
            v-model="formAuthUsername"
            type="text"
            placeholder="Username"
            class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
          />
          <input
            v-model="formAuthPassword"
            type="password"
            placeholder="Password"
            class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
          />
        </div>
      </div>
      <div class="flex gap-1.5 justify-end">
        <UButton size="xs" color="neutral" variant="ghost" @click="showForm = false">
          Cancel
        </UButton>
        <UButton size="xs" color="primary" variant="solid" @click="handleCreate">
          Add
        </UButton>
      </div>
    </div>

    <UButton v-if="!showForm" size="xs" color="primary" variant="solid" class="self-start" @click="showForm = true">
      + Map
    </UButton>

    <!-- Mappings list -->
    <div v-if="mappings.length === 0 && !showForm" class="text-gray-400 dark:text-gray-500 text-xs text-center py-1">
      No active domain mappings
    </div>
    <div
      v-for="m in mappings"
      :key="m.id"
      class="flex items-center gap-1.5 text-xs bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 min-w-0"
    >
      <span
        class="px-1 rounded text-[10px] font-medium shrink-0"
        :class="protocolColors[m.protocol]"
      >
        {{ m.protocol }}
      </span>
      <span class="text-gray-700 dark:text-gray-300 font-mono truncate min-w-0">{{ m.subdomain }}.{{ m.baseDomain }}</span>
      <svg
        v-if="m.basicAuth"
        class="w-3 h-3 text-amber-500 shrink-0"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
      </svg>
      <span class="text-gray-400 dark:text-gray-600 shrink-0">&rarr;</span>
      <span class="text-gray-500 dark:text-gray-400 truncate min-w-0 flex-1">{{ m.workerName }}:{{ m.internalPort }}</span>
      <button
        class="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors shrink-0 p-0.5"
        title="Remove mapping"
        @click="removeMapping(m.id)"
      >
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
