<script setup lang="ts">
import type { InitPresetInfo, EnvironmentInfo } from '~/types';

const props = defineProps<{
  initPresets: InitPresetInfo[];
}>();

const open = defineModel<boolean>('open', { default: false });

const { environments, createEnvironment, updateEnvironment, deleteEnvironment } = useEnvironments();

const editingId = ref<string | null>(null);
const creating = ref(false);
const viewingDefault = ref(false);

const editingEnvironment = computed(() =>
  editingId.value ? environments.value.find((e) => e.id === editingId.value) : undefined
);

const showEditor = computed(() => creating.value || editingId.value !== null || viewingDefault.value);

function startCreate() {
  editingId.value = null;
  viewingDefault.value = false;
  creating.value = true;
}

function startEdit(id: string) {
  creating.value = false;
  viewingDefault.value = false;
  editingId.value = id;
}

function startViewDefault() {
  creating.value = false;
  editingId.value = null;
  viewingDefault.value = true;
}

function cancelEdit() {
  creating.value = false;
  editingId.value = null;
  viewingDefault.value = false;
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
          <!-- Default environment (always shown) -->
          <div class="flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">Default</span>
              <span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                Built-in
              </span>
            </div>
            <div class="flex gap-1 shrink-0">
              <UButton size="xs" color="neutral" variant="ghost" @click="startViewDefault">
                View
              </UButton>
            </div>
          </div>

          <!-- Custom environments -->
          <div
            v-for="env in environments"
            :key="env.id"
            class="flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3"
          >
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate min-w-0">{{ env.name }}</div>
            <div class="flex gap-1 shrink-0">
              <UButton size="xs" color="neutral" variant="ghost" @click="startEdit(env.id)">
                Edit
              </UButton>
              <UButton size="xs" color="error" variant="ghost" @click="handleDelete(env.id)">
                Delete
              </UButton>
            </div>
          </div>
        </div>

        <!-- Inline editor -->
        <div v-if="showEditor" class="border border-gray-300 dark:border-gray-700 rounded-lg p-4">
          <EnvironmentEditor
            :init-presets="initPresets"
            :environment="viewingDefault ? {
              id: '',
              name: 'Default',
              cpuLimit: 0,
              memoryLimit: '',
              networkMode: 'full',
              allowedDomains: [],
              includePackageManagerDomains: false,
              dockerEnabled: true,
              envVars: '',
              setupScript: '',
              initScript: '',
              exposeApis: { portMappings: true, domainMappings: true, usage: true },
              enabledSkillIds: null,
              enabledInstructionIds: null,
              createdAt: '',
              updatedAt: '',
            } : editingEnvironment"
            :read-only="viewingDefault"
            @save="handleSave"
            @cancel="cancelEdit"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
