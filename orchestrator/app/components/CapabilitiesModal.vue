<script setup lang="ts">
import type { CapabilityInfo } from '~/types';

const open = defineModel<boolean>('open', { default: false });

const { capabilities, createCapability, updateCapability, deleteCapability } = useCapabilities();

const editingId = ref<string | null>(null);
const creating = ref(false);
const viewing = ref<string | null>(null);

const editForm = reactive({ name: '', content: '' });

const showEditor = computed(() => creating.value || editingId.value !== null || viewing.value !== null);

function startCreate() {
  editingId.value = null;
  viewing.value = null;
  editForm.name = '';
  editForm.content = '';
  creating.value = true;
}

function startEdit(capability: CapabilityInfo) {
  creating.value = false;
  viewing.value = null;
  editingId.value = capability.id;
  editForm.name = capability.name;
  editForm.content = capability.content;
}

function startView(capability: CapabilityInfo) {
  creating.value = false;
  editingId.value = null;
  viewing.value = capability.id;
  editForm.name = capability.name;
  editForm.content = capability.content;
}

function cancelEdit() {
  creating.value = false;
  editingId.value = null;
  viewing.value = null;
}

async function handleSave() {
  if (!editForm.name.trim() || !editForm.content.trim()) return;
  if (editingId.value) {
    await updateCapability(editingId.value, { name: editForm.name, content: editForm.content });
  } else {
    await createCapability({ name: editForm.name, content: editForm.content });
  }
  cancelEdit();
}

async function handleDelete(id: string) {
  await deleteCapability(id);
  if (editingId.value === id) cancelEdit();
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-4xl' }">
    <template #content>
      <div class="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Capabilities</h2>
          <div class="flex gap-2">
            <UButton v-if="!showEditor" size="sm" @click="startCreate">
              New
            </UButton>
            <UButton size="sm" color="neutral" variant="ghost" @click="open = false">
              Close
            </UButton>
          </div>
        </div>

        <!-- Capability list -->
        <div v-if="!showEditor" class="space-y-2">
          <template v-if="capabilities.length > 0">
            <div
              v-for="capability in capabilities"
              :key="capability.id"
              class="flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ capability.name }}</span>
                    <span
                      v-if="capability.builtIn"
                      class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                    >
                      Built-in
                    </span>
                  </div>
                </div>
              </div>
              <div class="flex gap-1 shrink-0">
                <UButton v-if="capability.builtIn" size="xs" color="neutral" variant="ghost" @click="startView(capability)">
                  View
                </UButton>
                <template v-else>
                  <UButton size="xs" color="neutral" variant="ghost" @click="startEdit(capability)">
                    Edit
                  </UButton>
                  <UButton size="xs" color="error" variant="ghost" @click="handleDelete(capability.id)">
                    Delete
                  </UButton>
                </template>
              </div>
            </div>
          </template>

          <div v-else class="text-gray-400 dark:text-gray-500 text-sm text-center py-4">
            No capabilities yet. Create one to get started.
          </div>
        </div>

        <!-- Inline editor -->
        <div v-if="showEditor" class="border border-gray-300 dark:border-gray-700 rounded-lg p-4 space-y-4">
          <UFormField label="Name">
            <UInput v-model="editForm.name" placeholder="Capability name" class="w-full" :disabled="!!viewing" />
          </UFormField>
          <UFormField label="Content" hint="SKILL.md (YAML frontmatter + Markdown)">
            <UTextarea
              v-model="editForm.content"
              :rows="16"
              placeholder="---
description: What this capability does
---

Capability content here..."
              class="w-full font-mono text-xs"
              :disabled="!!viewing"
            />
          </UFormField>
          <div class="flex gap-3">
            <UButton v-if="!viewing" @click="handleSave" :disabled="!editForm.name.trim() || !editForm.content.trim()">
              {{ editingId ? 'Update' : 'Create' }}
            </UButton>
            <UButton color="neutral" variant="outline" @click="cancelEdit">
              {{ viewing ? 'Close' : 'Cancel' }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
