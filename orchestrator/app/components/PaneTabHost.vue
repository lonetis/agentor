<script setup lang="ts">
import { PANE_ACTIVE_KEY } from '~/composables/usePolling';

const props = defineProps<{
  active: boolean;
}>();

// Pollers inside the tab (usePolling, tmux windows) pause while another tab of
// the same pane group is shown.
provide(PANE_ACTIVE_KEY, toRef(props, 'active'));
</script>

<template>
  <div v-show="active" class="absolute inset-0">
    <slot />
  </div>
</template>
