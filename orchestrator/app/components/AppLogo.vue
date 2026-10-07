<script setup lang="ts">
// The Agentor mark (robot + containers). Every place that renders it also
// renders an adjacent "Agentor" heading, so the image is decorative by
// default (`alt=""`); pass `alt` when it stands alone. Size it from the
// caller via classes (e.g. `class="h-9"`) — the image keeps its aspect ratio.
withDefaults(defineProps<{ alt?: string }>(), { alt: '' });
</script>

<template>
  <img
    src="~/assets/img/agentor-symbol.png"
    :alt="alt"
    data-testid="agentor-logo"
    class="w-auto select-none"
    draggable="false"
  />
</template>
