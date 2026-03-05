<script setup lang="ts">
import type { SkillInfo } from '~/types';

const open = defineModel<boolean>('open', { default: false });

const { skills, createSkill, updateSkill, deleteSkill } = useSkills();

const editingId = ref<string | null>(null);
const creating = ref(false);
const viewing = ref<string | null>(null);

const editContent = ref('');

const showEditor = computed(() => creating.value || editingId.value !== null || viewing.value !== null);

const FRONTMATTER_TEMPLATE = `---
name: my-skill
description: What this skill does and when to use it
---

`;

function startCreate() {
  editingId.value = null;
  viewing.value = null;
  editContent.value = FRONTMATTER_TEMPLATE;
  creating.value = true;
}

function startEdit(skill: SkillInfo) {
  creating.value = false;
  viewing.value = null;
  editingId.value = skill.id;
  editContent.value = skill.content;
}

function startView(skill: SkillInfo) {
  creating.value = false;
  editingId.value = null;
  viewing.value = skill.id;
  editContent.value = skill.content;
}

function cancelEdit() {
  creating.value = false;
  editingId.value = null;
  viewing.value = null;
}

async function handleSave() {
  if (!editContent.value.trim()) return;
  if (editingId.value) {
    await updateSkill(editingId.value, editContent.value);
  } else {
    await createSkill(editContent.value);
  }
  cancelEdit();
}

async function handleDelete(id: string) {
  await deleteSkill(id);
  if (editingId.value === id) cancelEdit();
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-4xl' }">
    <template #content>
      <div class="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Skills</h2>
          <div class="flex gap-2">
            <UButton v-if="!showEditor" size="sm" @click="startCreate">
              New
            </UButton>
            <UButton size="sm" color="neutral" variant="ghost" @click="open = false">
              Close
            </UButton>
          </div>
        </div>

        <!-- Skill list -->
        <div v-if="!showEditor" class="space-y-2">
          <template v-if="skills.length > 0">
            <div
              v-for="skill in skills"
              :key="skill.id"
              class="flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ skill.name }}</span>
                    <span
                      v-if="skill.builtIn"
                      class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                    >
                      Built-in
                    </span>
                  </div>
                </div>
              </div>
              <div class="flex gap-1 shrink-0">
                <UButton v-if="skill.builtIn" size="xs" color="neutral" variant="ghost" @click="startView(skill)">
                  View
                </UButton>
                <template v-else>
                  <UButton size="xs" color="neutral" variant="ghost" @click="startEdit(skill)">
                    Edit
                  </UButton>
                  <UButton size="xs" color="error" variant="ghost" @click="handleDelete(skill.id)">
                    Delete
                  </UButton>
                </template>
              </div>
            </div>
          </template>

          <div v-else class="text-gray-400 dark:text-gray-500 text-sm text-center py-4">
            No skills yet. Create one to get started.
          </div>
        </div>

        <!-- Inline editor -->
        <div v-if="showEditor" class="border border-gray-300 dark:border-gray-700 rounded-lg p-4 space-y-4">
          <UFormField label="SKILL.md" hint="YAML frontmatter + Markdown">
            <UTextarea
              v-model="editContent"
              :rows="16"
              placeholder="---
name: my-skill
description: What this skill does
---

Skill instructions here..."
              class="w-full font-mono text-xs"
              :disabled="!!viewing"
            />
          </UFormField>
          <div class="flex gap-3">
            <UButton v-if="!viewing" @click="handleSave" :disabled="!editContent.trim()">
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
