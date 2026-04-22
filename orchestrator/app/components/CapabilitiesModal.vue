<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false });
const { capabilities, createCapability, updateCapability, deleteCapability } = useCapabilities();

const CAPABILITY_PLACEHOLDER = `---
description: What this capability does
---

Capability content here...`;
</script>

<template>
  <ListEditorModal
    v-model:open="open"
    title="Capabilities"
    :items="capabilities"
    empty-message="No capabilities yet. Create one to get started."
    name-placeholder="Capability name"
    content-hint="SKILL.md (YAML frontmatter + Markdown)"
    :content-rows="16"
    :content-placeholder="CAPABILITY_PLACEHOLDER"
    @create="(body) => createCapability(body)"
    @update="(id, body) => updateCapability(id, body)"
    @delete="(id) => deleteCapability(id)"
  />
</template>
