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
      icon-name="i-lucide-monitor"
      :url="`/desktop/${activeTab.containerId}/vnc.html?autoconnect=true&resize=scale&quality=9&compression=0&reconnect=true&reconnect_delay=2000&path=ws/desktop/${activeTab.containerId}`"
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
      icon-name="i-lucide-code"
      :url="`/editor/${activeTab.containerId}/?folder=/workspace`"
    />
    <LogPane
      v-else-if="activeTab?.type === 'logs'"
      :key="activeTab.id"
    />
    <TerminalPlaceholder v-else />
  </div>
</template>
