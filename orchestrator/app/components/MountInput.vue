<script setup lang="ts">
import type { MountConfig } from '~/types';

const props = defineProps<{
  modelValue: MountConfig;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: MountConfig];
  remove: [];
}>();

function update(field: keyof MountConfig, value: string | boolean) {
  emit('update:modelValue', { ...props.modelValue, [field]: value });
}
</script>

<template>
  <div class="flex flex-wrap sm:flex-nowrap gap-2 items-center">
    <UInput
      :model-value="modelValue.source"
      placeholder="Host path"
      aria-label="Host path"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      size="xs"
      class="flex-1 min-w-[8rem]"
      @update:model-value="update('source', $event)"
    />
    <span class="text-gray-400 dark:text-gray-500 text-xs" aria-hidden="true">:</span>
    <UInput
      :model-value="modelValue.target"
      placeholder="Container path"
      aria-label="Container path"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      size="xs"
      class="flex-1 min-w-[8rem]"
      @update:model-value="update('target', $event)"
    />
    <UCheckbox
      :model-value="modelValue.readOnly || false"
      label="ro"
      size="xs"
      @update:model-value="update('readOnly', $event)"
    />
    <UButton
      icon="i-lucide-x"
      size="xs"
      color="neutral"
      variant="ghost"
      aria-label="Remove mount"
      @click="emit('remove')"
    />
  </div>
</template>
