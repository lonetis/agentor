<script setup lang="ts">
import { usePwa } from '~/composables/usePwa';

// Icon-only install affordance for the sidebar footer: the browser's install
// prompt where one is available, otherwise (iOS) a hint how to add the app to
// the home screen. Renders nothing once the app runs installed.
const { canInstall, showIosHint, install, dismissIosHint } = usePwa();

const hintOpen = ref(false);

function onDismissHint() {
  hintOpen.value = false;
  dismissIosHint();
}
</script>

<template>
  <UButton
    v-if="canInstall"
    size="xs"
    color="neutral"
    variant="ghost"
    icon="i-lucide-monitor-down"
    aria-label="Install app"
    title="Install app"
    class="flex-shrink-0 pointer-coarse:p-2"
    @click="install"
  />
  <UPopover v-else-if="showIosHint" v-model:open="hintOpen">
    <UButton
      size="xs"
      color="neutral"
      variant="ghost"
      icon="i-lucide-share"
      aria-label="Add to Home Screen"
      title="Add to Home Screen"
      class="flex-shrink-0 pointer-coarse:p-2"
    />
    <template #content>
      <div class="max-w-60 p-3 text-xs text-gray-700 dark:text-gray-300">
        <p>
          Tap <UIcon name="i-lucide-share" class="inline-block size-3.5 align-[-2px]" aria-hidden="true" />
          Share, then <span class="font-medium text-gray-900 dark:text-white">Add to Home Screen</span>.
        </p>
        <button
          type="button"
          class="mt-2 rounded text-primary-600 dark:text-primary-400 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 pointer-coarse:py-1.5"
          @click="onDismissHint"
        >
          Dismiss
        </button>
      </div>
    </template>
  </UPopover>
</template>
