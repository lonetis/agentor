<script setup lang="ts">
import type { PaneLeafNode } from '~/types';

const props = defineProps<{
  group: PaneLeafNode;
}>();

const activeTabId = computed(() => props.group.activeTabId);

// Track tabs that have been activated at least once.
// v-if creates the component on first activation (proper dimensions available),
// PaneTabHost keeps it alive (v-show) after that so switching is instant and
// sockets survive, while pausing its polling when hidden.
const mountedTabIds = ref(new Set<string>());

watch(activeTabId, (id) => {
  if (id) mountedTabIds.value.add(id);
}, { immediate: true });

// Clean up entries for tabs that have been removed from this group. Watching
// the id list (not the tabs deeply) skips unrelated tab changes such as renames.
watch(() => props.group.tabs.map((t) => t.id).join('|'), () => {
  const currentIds = new Set(props.group.tabs.map((t) => t.id));
  for (const id of mountedTabIds.value) {
    if (!currentIds.has(id)) mountedTabIds.value.delete(id);
  }
});
</script>

<template>
  <div class="absolute inset-0">
    <template v-for="tab in group.tabs" :key="tab.id">
      <PaneTabHost
        v-if="mountedTabIds.has(tab.id)"
        :active="tab.id === activeTabId"
      >
        <TerminalPane
          v-if="tab.type === 'terminal'"
          :container-id="tab.containerId"
        />
        <ServicePane
          v-else-if="tab.type === 'desktop'"
          :container-id="tab.containerId"
          endpoint="desktop"
          label="Desktop"
          icon-name="i-lucide-monitor"
          :url="`/desktop/${tab.containerId}/vnc.html?autoconnect=true&resize=scale&quality=9&compression=0&reconnect=true&reconnect_delay=2000&path=ws/desktop/${tab.containerId}`"
        />
        <AppsPane
          v-else-if="tab.type === 'apps'"
          :container-id="tab.containerId"
        />
        <ServicePane
          v-else-if="tab.type === 'editor'"
          :container-id="tab.containerId"
          endpoint="editor"
          label="Editor"
          icon-name="i-lucide-code"
          :url="`/editor/${tab.containerId}/?folder=/workspace`"
        />
        <LogPane
          v-else-if="tab.type === 'logs'"
        />
      </PaneTabHost>
    </template>
    <TerminalPlaceholder v-if="!group.tabs.length" />
  </div>
</template>
