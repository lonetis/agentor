<script setup lang="ts">
import type { PaneLeafNode } from '~/types';

const props = defineProps<{
  group: PaneLeafNode;
}>();

const activeTab = computed(() => {
  if (!props.group.activeTabId) return null;
  return props.group.tabs.find((t) => t.id === props.group.activeTabId) ?? null;
});
</script>

<template>
  <div class="absolute inset-0">
    <TerminalPane
      v-if="activeTab?.type === 'terminal'"
      :key="activeTab.id"
      :container-id="activeTab.containerId"
    />
    <ServicePane
      v-else-if="activeTab?.type === 'desktop'"
      :key="activeTab.id"
      :container-id="activeTab.containerId"
      endpoint="desktop"
      label="Desktop"
      icon="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      :url="`/desktop/${activeTab.containerId}/vnc.html?autoconnect=true&resize=scale&quality=6&compression=2&path=ws/desktop/${activeTab.containerId}`"
    />
    <AppsPane
      v-else-if="activeTab?.type === 'apps'"
      :key="activeTab.id"
      :container-id="activeTab.containerId"
    />
    <ServicePane
      v-else-if="activeTab?.type === 'editor'"
      :key="activeTab.id"
      :container-id="activeTab.containerId"
      endpoint="editor"
      label="Editor"
      icon="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
      :url="`/editor/${activeTab.containerId}/?folder=/workspace`"
    />
    <TerminalPlaceholder v-else />
  </div>
</template>
