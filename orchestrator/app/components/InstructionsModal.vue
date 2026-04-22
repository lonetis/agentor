<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false });
const { entries, createEntry, updateEntry, deleteEntry } = useInstructions();
</script>

<template>
  <ListEditorModal
    v-model:open="open"
    title="Instructions"
    :items="entries"
    empty-message="No instructions yet. Create one to get started."
    name-placeholder="Entry name"
    content-hint="Markdown"
    :content-rows="12"
    content-placeholder="Entry content (Markdown)"
    @create="(body) => createEntry(body)"
    @update="(id, body) => updateEntry(id, body)"
    @delete="(id) => deleteEntry(id)"
  />
</template>
