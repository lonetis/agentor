<script setup lang="ts">
import type { InitScriptInfo } from '~/types';

const open = defineModel<boolean>('open', { default: false });

const { initScripts, createInitScript, updateInitScript, deleteInitScript } = useInitScripts();

const editingId = ref<string | null>(null);
const creating = ref(false);
const viewing = ref<string | null>(null);

const editForm = reactive({ name: '', content: '' });

const showEditor = computed(() => creating.value || editingId.value !== null || viewing.value !== null);

function startCreate() {
  editingId.value = null;
  viewing.value = null;
  editForm.name = '';
  editForm.content = '#!/bin/bash\n';
  creating.value = true;
}

function startEdit(script: InitScriptInfo) {
  creating.value = false;
  viewing.value = null;
  editingId.value = script.id;
  editForm.name = script.name;
  editForm.content = script.content;
}

function startView(script: InitScriptInfo) {
  creating.value = false;
  editingId.value = null;
  viewing.value = script.id;
  editForm.name = script.name;
  editForm.content = script.content;
}

function cancelEdit() {
  creating.value = false;
  editingId.value = null;
  viewing.value = null;
}

async function handleSave() {
  if (!editForm.name.trim() || !editForm.content.trim()) return;
  if (editingId.value) {
    await updateInitScript(editingId.value, { name: editForm.name, content: editForm.content });
  } else {
    await createInitScript({ name: editForm.name, content: editForm.content });
  }
  cancelEdit();
}

async function handleDelete(id: string) {
  await deleteInitScript(id);
  if (editingId.value === id) cancelEdit();
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-4xl' }">
    <template #content>
      <div class="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Init Scripts</h2>
          <div class="flex gap-2">
            <UButton v-if="!showEditor" size="sm" @click="startCreate">
              New
            </UButton>
            <UButton size="sm" color="neutral" variant="ghost" @click="open = false">
              Close
            </UButton>
          </div>
        </div>

        <!-- Script list -->
        <div v-if="!showEditor" class="space-y-2">
          <template v-if="initScripts.length > 0">
            <div
              v-for="script in initScripts"
              :key="script.id"
              class="flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ script.name }}</span>
                    <span
                      v-if="script.builtIn"
                      class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                    >
                      Built-in
                    </span>
                  </div>
                </div>
              </div>
              <div class="flex gap-1 shrink-0">
                <UButton v-if="script.builtIn" size="xs" color="neutral" variant="ghost" @click="startView(script)">
                  View
                </UButton>
                <template v-else>
                  <UButton size="xs" color="neutral" variant="ghost" @click="startEdit(script)">
                    Edit
                  </UButton>
                  <UButton size="xs" color="error" variant="ghost" @click="handleDelete(script.id)">
                    Delete
                  </UButton>
                </template>
              </div>
            </div>
          </template>

          <div v-else class="text-gray-400 dark:text-gray-500 text-sm text-center py-4">
            No init scripts yet. Create one to get started.
          </div>
        </div>

        <!-- Inline editor -->
        <div v-if="showEditor" class="border border-gray-300 dark:border-gray-700 rounded-lg p-4 space-y-4">
          <UFormField label="Name">
            <UInput v-model="editForm.name" placeholder="Script name" class="w-full" :disabled="!!viewing" />
          </UFormField>
          <UFormField label="Script" hint="Bash">
            <UTextarea
              v-model="editForm.content"
              :rows="8"
              placeholder="#!/bin/bash&#10;# Script to run in tmux on startup"
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
