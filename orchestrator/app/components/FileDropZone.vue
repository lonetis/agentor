<script setup lang="ts">
const props = defineProps<{
  modelValue: File[];
}>();

const emit = defineEmits<{
  'update:modelValue': [files: File[]];
}>();

const isDragOver = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

// Reset native file input when files are cleared externally (e.g., modal close)
// so re-uploading the same files will trigger the change event again
watch(() => props.modelValue, (val) => {
  if (val.length === 0 && fileInputRef.value) {
    fileInputRef.value.value = '';
  }
});

function onDragOver(e: DragEvent) {
  e.preventDefault();
  isDragOver.value = true;
}

function onDragLeave() {
  isDragOver.value = false;
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  isDragOver.value = false;
  if (!e.dataTransfer) return;

  const items = e.dataTransfer.items;
  if (items) {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i]?.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      collectEntries(entries).then((files) => {
        emit('update:modelValue', [...props.modelValue, ...files]);
      });
      return;
    }
  }

  // Fallback: plain file list (no folder support)
  const files = Array.from(e.dataTransfer.files);
  emit('update:modelValue', [...props.modelValue, ...files]);
}

async function collectEntries(entries: FileSystemEntry[]): Promise<File[]> {
  const files: File[] = [];

  async function processEntry(entry: FileSystemEntry, path: string) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve) => {
        (entry as FileSystemFileEntry).file((f) => {
          resolve(new File([f], path + f.name, { type: f.type, lastModified: f.lastModified }));
        });
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      const subEntries = await readAllEntries(dirReader);
      for (const sub of subEntries) {
        await processEntry(sub, path + entry.name + '/');
      }
    }
  }

  for (const entry of entries) {
    await processEntry(entry, '');
  }
  return files;
}

// readEntries returns at most 100 entries per call; must loop
async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve));
    all.push(...batch);
  } while (batch.length > 0);
  return all;
}

function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;
  const files = Array.from(input.files).map((f) => {
    const path = (f as any).webkitRelativePath || f.name;
    return new File([f], path, { type: f.type, lastModified: f.lastModified });
  });
  emit('update:modelValue', [...props.modelValue, ...files]);
  input.value = '';
}

function removeFile(idx: number) {
  const updated = [...props.modelValue];
  updated.splice(idx, 1);
  emit('update:modelValue', updated);
}

function clearAll() {
  emit('update:modelValue', []);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const totalSize = computed(() => props.modelValue.reduce((sum, f) => sum + f.size, 0));
</script>

<template>
  <div>
    <div
      class="border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer"
      :class="isDragOver ? 'border-blue-500 bg-blue-500/10' : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="fileInputRef?.click()"
    >
      <input
        ref="fileInputRef"
        type="file"
        multiple
        webkitdirectory
        class="hidden"
        @change="onFileInput"
      />
      <svg class="w-6 h-6 mx-auto mb-1.5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Drop files or folders here
      </p>
      <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
        or click to browse folders
      </p>
    </div>

    <div v-if="modelValue.length > 0" class="mt-2">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {{ modelValue.length }} file{{ modelValue.length !== 1 ? 's' : '' }} ({{ formatSize(totalSize) }})
        </span>
        <UButton size="xs" color="neutral" variant="link" @click="clearAll">
          Clear all
        </UButton>
      </div>
      <div class="max-h-32 overflow-y-auto space-y-0.5">
        <div
          v-for="(file, idx) in modelValue"
          :key="idx"
          class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded hover:bg-gray-100/60 dark:hover:bg-gray-800/50 group"
        >
          <span class="truncate mr-2" :title="file.name">{{ file.name }}</span>
          <button
            class="text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 shrink-0"
            @click.stop="removeFile(idx)"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
