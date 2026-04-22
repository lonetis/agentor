<script setup lang="ts">
interface ResourceItem {
  id: string;
  name: string;
  content: string;
  builtIn?: boolean;
}

const props = withDefaults(defineProps<{
  title: string;
  items: ResourceItem[];
  emptyMessage: string;
  namePlaceholder: string;
  contentLabel?: string;
  contentHint: string;
  contentRows?: number;
  contentPlaceholder: string;
  /** Seeded into the content field when the user clicks New (e.g. shebang line). */
  initialContent?: string;
}>(), {
  contentLabel: 'Content',
  contentRows: 12,
  initialContent: '',
});

const emit = defineEmits<{
  create: [body: { name: string; content: string }];
  update: [id: string, body: { name: string; content: string }];
  delete: [id: string];
}>();

const open = defineModel<boolean>('open', { default: false });

const editingId = ref<string | null>(null);
const creating = ref(false);
const viewing = ref<string | null>(null);
const editForm = reactive({ name: '', content: '' });
const showEditor = computed(() => creating.value || editingId.value !== null || viewing.value !== null);

function startCreate() {
  editingId.value = null;
  viewing.value = null;
  editForm.name = '';
  editForm.content = props.initialContent;
  creating.value = true;
}

function startEdit(item: ResourceItem) {
  creating.value = false;
  viewing.value = null;
  editingId.value = item.id;
  editForm.name = item.name;
  editForm.content = item.content;
}

function startView(item: ResourceItem) {
  creating.value = false;
  editingId.value = null;
  viewing.value = item.id;
  editForm.name = item.name;
  editForm.content = item.content;
}

function cancelEdit() {
  creating.value = false;
  editingId.value = null;
  viewing.value = null;
}

async function handleSave() {
  if (!editForm.name.trim() || !editForm.content.trim()) return;
  const body = { name: editForm.name, content: editForm.content };
  if (editingId.value) {
    emit('update', editingId.value, body);
  } else {
    emit('create', body);
  }
  cancelEdit();
}

function handleDelete(id: string) {
  emit('delete', id);
  if (editingId.value === id) cancelEdit();
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-4xl' }">
    <template #content>
      <div class="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ title }}</h2>
          <div class="flex gap-2">
            <UButton v-if="!showEditor" size="sm" @click="startCreate">
              New
            </UButton>
            <UButton size="sm" color="neutral" variant="ghost" @click="open = false">
              Close
            </UButton>
          </div>
        </div>

        <div v-if="!showEditor" class="space-y-2">
          <template v-if="items.length > 0">
            <div
              v-for="item in items"
              :key="item.id"
              class="flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-3"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{{ item.name }}</span>
                    <span
                      v-if="item.builtIn"
                      class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                    >
                      Built-in
                    </span>
                  </div>
                </div>
              </div>
              <div class="flex gap-1 shrink-0">
                <UButton v-if="item.builtIn" size="xs" color="neutral" variant="ghost" @click="startView(item)">
                  View
                </UButton>
                <template v-else>
                  <UButton size="xs" color="neutral" variant="ghost" @click="startEdit(item)">
                    Edit
                  </UButton>
                  <UButton size="xs" color="error" variant="ghost" @click="handleDelete(item.id)">
                    Delete
                  </UButton>
                </template>
              </div>
            </div>
          </template>

          <div v-else class="text-gray-400 dark:text-gray-500 text-sm text-center py-4">
            {{ emptyMessage }}
          </div>
        </div>

        <div v-if="showEditor" class="border border-gray-300 dark:border-gray-700 rounded-lg p-4 space-y-4">
          <UFormField label="Name">
            <UInput v-model="editForm.name" :placeholder="namePlaceholder" class="w-full" :disabled="!!viewing" />
          </UFormField>
          <UFormField :label="contentLabel" :hint="contentHint">
            <UTextarea
              v-model="editForm.content"
              :rows="contentRows"
              :placeholder="contentPlaceholder"
              class="w-full font-mono text-xs"
              :disabled="!!viewing"
            />
          </UFormField>
          <div class="flex gap-3">
            <UButton v-if="!viewing" :disabled="!editForm.name.trim() || !editForm.content.trim()" @click="handleSave">
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
