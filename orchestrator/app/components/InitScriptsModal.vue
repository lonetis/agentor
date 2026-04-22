<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false });
const { initScripts, createInitScript, updateInitScript, deleteInitScript } = useInitScripts();
</script>

<template>
  <ListEditorModal
    v-model:open="open"
    title="Init Scripts"
    :items="initScripts"
    empty-message="No init scripts yet. Create one to get started."
    name-placeholder="Script name"
    content-label="Script"
    content-hint="Bash"
    :content-rows="8"
    content-placeholder="#!/bin/bash&#10;# Script to run in tmux on startup"
    initial-content="#!/bin/bash&#10;"
    @create="(body) => createInitScript(body)"
    @update="(id, body) => updateInitScript(id, body)"
    @delete="(id) => deleteInitScript(id)"
  />
</template>
