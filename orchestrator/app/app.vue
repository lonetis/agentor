<script setup lang="ts">
// Browser / installed-app chrome follows the colour mode (gray-50 / gray-950,
// the page backgrounds). A single reactive tag: a static one in nuxt.config
// would be left behind as a duplicate.
const colorMode = useColorMode();
useHead({
  meta: [{ name: 'theme-color', content: computed(() => (colorMode.value === 'light' ? '#f9fafb' : '#030712')) }],
});
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
