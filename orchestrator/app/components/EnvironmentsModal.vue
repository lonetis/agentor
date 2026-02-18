<script setup lang="ts">
import type { InitPresetInfo, EnvironmentInfo } from '~/types';

const props = defineProps<{
  initPresets: InitPresetInfo[];
}>();

const open = defineModel<boolean>('open', { default: false });

const { environments, createEnvironment, updateEnvironment, deleteEnvironment } = useEnvironments();

const editingId = ref<string | null>(null);
const creating = ref(false);

const editingEnvironment = computed(() =>
  editingId.value ? environments.value.find((e) => e.id === editingId.value) : undefined
);

const showEditor = computed(() => creating.value || editingId.value !== null);

function startCreate() {
  editingId.value = null;
  creating.value = true;
}

function startEdit(id: string) {
  creating.value = false;
  editingId.value = id;
}

function cancelEdit() {
  creating.value = false;
  editingId.value = null;
}

async function handleSave(data: Partial<EnvironmentInfo>) {
  if (editingId.value) {
    await updateEnvironment(editingId.value, data);
  } else {
    await createEnvironment(data);
  }
  cancelEdit();
}

async function handleDelete(id: string) {
  await deleteEnvironment(id);
  if (editingId.value === id) {
    cancelEdit();
  }
}

const networkModeBadge: Record<string, { label: string; class: string }> = {
  full: { label: 'Full', class: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' },
  'package-managers': { label: 'PM only', class: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' },
  custom: { label: 'Custom', class: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300' },
  block: { label: 'Blocked', class: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300' },
  'block-all': { label: 'Block all', class: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300' },
};
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-4xl' }">
    <template #content>
      <div class="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Environments</h2>
          <div class="flex gap-2">
            <UButton v-if="!showEditor" size="sm" @click="startCreate">
              New Environment
            </UButton>
            <UButton size="sm" color="neutral" variant="ghost" @click="open = false">
              Close
            </UButton>
          </div>
        </div>

        <!-- Environment list -->
        <div v-if="!showEditor" class="space-y-2">
          <template v-if="environments.length > 0">
            <div
              v-for="env in environments"
              :key="env.id"
              class="flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div class="min-w-0">
                  <div class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ env.name }}</div>
                  <div class="flex items-center gap-2 mt-0.5">
                    <span
                      class="px-1.5 py-0.5 rounded text-[10px] font-medium"
                      :class="networkModeBadge[env.networkMode]?.class"
                    >
                      {{ networkModeBadge[env.networkMode]?.label }}
                    </span>
                    <span v-if="env.cpuLimit" class="text-[10px] text-gray-400 dark:text-gray-500">{{ env.cpuLimit }} CPU</span>
                    <span v-if="env.memoryLimit" class="text-[10px] text-gray-400 dark:text-gray-500">{{ env.memoryLimit }} mem</span>
                  </div>
                </div>
              </div>
              <div class="flex gap-1 shrink-0">
                <UButton size="xs" color="neutral" variant="ghost" @click="startEdit(env.id)">
                  Edit
                </UButton>
                <UButton size="xs" color="error" variant="ghost" @click="handleDelete(env.id)">
                  Delete
                </UButton>
              </div>
            </div>
          </template>

          <div v-else class="text-gray-400 dark:text-gray-500 text-sm text-center py-4">
            No environments yet. Create one to get started.
          </div>
        </div>

        <!-- Inline editor -->
        <div v-if="showEditor" class="border border-gray-300 dark:border-gray-700 rounded-lg p-4">
          <EnvironmentEditor
            :init-presets="initPresets"
            :environment="editingEnvironment"
            @save="handleSave"
            @cancel="cancelEdit"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
