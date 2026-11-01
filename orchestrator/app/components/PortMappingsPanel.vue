<script setup lang="ts">
import type { ContainerInfo, ArchivedWorker } from '~/types';

const props = defineProps<{
  containers: ContainerInfo[];
  archivedWorkers?: ArchivedWorker[];
}>();

const { mappings, createMapping, removeMapping } = usePortMappings();

const showForm = ref(false);
const formType = ref<'localhost' | 'external'>('localhost');
const formExternalPort = ref<number | undefined>();
const formWorkerId = ref('');
const formInternalPort = ref<number | undefined>();
const formError = ref('');

const runningContainers = computed(() =>
  props.containers.filter((c) => c.status === 'running')
);

// Mappings store the worker id in `workerId`; resolve the friendly display
// name from it. Keyed by the worker UUID `id` so it covers active
// (running/stopped) AND archived workers — mappings persist across archive,
// and an archived worker would otherwise render its raw id.
const workerLabelById = computed(() => {
  const map = new Map<string, string>();
  for (const c of props.containers) map.set(c.id, c.displayName || shortName(c.id));
  for (const w of props.archivedWorkers ?? []) map.set(w.id, w.displayName || shortName(w.id));
  return map;
});

// Mappings are grouped by their owning worker so the list stays readable as the
// number of mappings grows. Each group is independently collapsible.
const groupedMappings = computed(() => {
  const groups = new Map<string, typeof mappings.value>();
  for (const m of mappings.value) {
    const arr = groups.get(m.workerId);
    if (arr) arr.push(m);
    else groups.set(m.workerId, [m]);
  }
  return [...groups.entries()]
    .map(([workerId, items]) => ({
      workerId,
      label: workerLabelById.value.get(workerId) || shortName(workerId),
      mappings: items,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

const collapsedGroups = ref<Set<string>>(new Set());
function toggleGroup(workerId: string) {
  const s = collapsedGroups.value;
  if (s.has(workerId)) s.delete(workerId);
  else s.add(workerId);
  collapsedGroups.value = new Set(s);
}

function openForm() {
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
}

function resetForm() {
  formType.value = 'localhost';
  formExternalPort.value = undefined;
  formWorkerId.value = '';
  formInternalPort.value = undefined;
  formError.value = '';
  showForm.value = false;
}

async function handleCreate() {
  if (!formExternalPort.value || !formWorkerId.value || !formInternalPort.value) return;
  formError.value = '';
  try {
    await createMapping({
      externalPort: formExternalPort.value,
      type: formType.value,
      workerId: formWorkerId.value,
      internalPort: formInternalPort.value,
    });
  } catch (err: any) {
    // Keep the form open and the entered values intact so the user can correct
    // a rejected mapping (duplicate port 409, stopped worker, validation 400).
    formError.value = err?.data?.statusMessage || err?.statusMessage || 'Failed to create port mapping';
    return;
  }
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
          aria-label="Mapping type"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500/40 shrink-0"
        >
          <option value="localhost">internal</option>
          <option value="external">external</option>
        </select>
        <select
          v-model="formWorkerId"
          aria-label="Worker"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500/40 flex-1 min-w-0"
        >
          <option value="" disabled>Worker</option>
          <option v-for="c in runningContainers" :key="c.id" :value="c.id">
            {{ c.displayName || shortName(c.id) }}
          </option>
        </select>
      </div>
      <div class="flex gap-1.5 items-center">
        <input
          v-model.number="formExternalPort"
          type="number"
          inputmode="numeric"
          pattern="[0-9]*"
          enterkeyhint="done"
          placeholder="External port"
          aria-label="External port"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500/40 flex-1 min-w-0"
        />
        <span class="text-gray-400 dark:text-gray-600 shrink-0">&rarr;</span>
        <input
          v-model.number="formInternalPort"
          type="number"
          inputmode="numeric"
          pattern="[0-9]*"
          enterkeyhint="done"
          placeholder="Internal port"
          aria-label="Internal port"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500/40 flex-1 min-w-0"
        />
        <UButton size="xs" color="primary" variant="solid" class="shrink-0" @click="handleCreate">
          Add
        </UButton>
      </div>
      <p v-if="formError" role="alert" class="text-red-500 dark:text-red-400 text-[11px]">{{ formError }}</p>
      <UButton size="xs" color="neutral" variant="ghost" class="self-end" @click="closeForm">
        Cancel
      </UButton>
    </div>

    <UButton v-if="!showForm" size="xs" color="primary" variant="solid" class="self-start" @click="openForm">
      + Map
    </UButton>

    <!-- Mappings list, grouped by worker -->
    <div v-if="mappings.length === 0 && !showForm" class="text-gray-500 dark:text-gray-400 text-xs text-center py-1">
      No active port mappings
    </div>
    <div v-for="g in groupedMappings" :key="g.workerId" class="flex flex-col gap-1">
      <button
        type="button"
        class="flex items-center gap-1.5 w-full text-left text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800/60 rounded px-1 py-1 transition-colors min-w-0"
        :aria-expanded="!collapsedGroups.has(g.workerId)"
        @click="toggleGroup(g.workerId)"
      >
        <UIcon
          :name="collapsedGroups.has(g.workerId) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"
          class="size-3.5 shrink-0 text-gray-400 dark:text-gray-500"
        />
        <span class="truncate min-w-0 flex-1" :title="g.label">{{ g.label }}</span>
        <span class="shrink-0 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 rounded-full px-1.5 leading-4 tabular-nums">
          {{ g.mappings.length }}
        </span>
      </button>
      <div v-if="!collapsedGroups.has(g.workerId)" class="flex flex-col gap-1 pl-2">
        <div
          v-for="m in g.mappings"
          :key="m.externalPort"
          class="flex items-center gap-1.5 text-xs bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 min-w-0"
        >
          <span
            class="px-1 rounded text-[10px] font-medium shrink-0"
            :class="m.type === 'localhost' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300'"
          >
            {{ m.type === 'localhost' ? 'internal' : 'external' }}
          </span>
          <span class="text-gray-700 dark:text-gray-300 font-mono shrink-0">:{{ m.externalPort }}</span>
          <span class="text-gray-400 dark:text-gray-600 shrink-0">&rarr;</span>
          <span class="text-gray-500 dark:text-gray-400 font-mono truncate min-w-0 flex-1">:{{ m.internalPort }}</span>
          <button
            type="button"
            class="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors shrink-0 p-0.5 pointer-coarse:p-2 pointer-coarse:-my-1.5"
            title="Remove mapping"
            aria-label="Remove mapping"
            @click="removeMapping(m.externalPort)"
          >
            <UIcon name="i-lucide-x" class="size-3" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
