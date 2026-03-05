<script setup lang="ts">
import type { EnvironmentInfo } from '~/types';

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

</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-4xl' }">
    <template #content>
      <div class="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Environments</h2>
          <div class="flex gap-2">
            <UButton v-if="!showEditor" size="sm" @click="startCreate">
              New
            </UButton>
            <UButton size="sm" color="neutral" variant="ghost" @click="open = false">
              Close
            </UButton>
          </div>
        </div>

        <!-- Environment list -->
        <div v-if="!showEditor" class="space-y-2">
          <div
            v-for="env in environments"
            :key="env.id"
            class="flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ env.name }}</span>
                  <span
                    v-if="env.builtIn"
                    class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                  >
                    Built-in
                  </span>
                </div>
              </div>
            </div>
            <div class="flex gap-1 shrink-0">
              <template v-if="env.builtIn">
                <UButton size="xs" color="neutral" variant="ghost" @click="startEdit(env.id)">
                  View
                </UButton>
              </template>
              <template v-else>
                <UButton size="xs" color="neutral" variant="ghost" @click="startEdit(env.id)">
                  Edit
                </UButton>
                <UButton size="xs" color="error" variant="ghost" @click="handleDelete(env.id)">
                  Delete
                </UButton>
              </template>
            </div>
          </div>
        </div>

        <!-- Inline editor -->
        <div v-if="showEditor" class="border border-gray-300 dark:border-gray-700 rounded-lg p-4">
          <EnvironmentEditor
            :environment="editingEnvironment"
            :read-only="editingEnvironment?.builtIn"
            @save="handleSave"
            @cancel="cancelEdit"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
