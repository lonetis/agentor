<script setup lang="ts">
import type { PaneLeafNode } from '~/types';

const props = defineProps<{
  group: PaneLeafNode;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  focusGroup: [];
}>();

const activeTabId = computed(() => props.group.activeTabId);
const terminalPanes = ref<{ focusTerminal: () => void }[]>([]);

function focusTerminal() {
  for (const pane of terminalPanes.value) pane.focusTerminal();
}

defineExpose({ focusTerminal });

// Track tabs that have been activated at least once.
// v-if creates the component on first activation (proper dimensions available),
// v-show keeps it alive after that so switching is instant.
const mountedTabIds = ref(new Set<string>());

watch(activeTabId, (id) => {
  if (id) mountedTabIds.value.add(id);
}, { immediate: true });

// Clean up entries for tabs that have been removed from this group
watch(() => props.group.tabs, (tabs) => {
  const currentIds = new Set(tabs.map(t => t.id));
  for (const id of mountedTabIds.value) {
    if (!currentIds.has(id)) mountedTabIds.value.delete(id);
  }
}, { deep: true });
</script>

<template>
  <div class="absolute inset-0">
    <template v-for="tab in group.tabs" :key="tab.id">
      <div
        v-if="mountedTabIds.has(tab.id)"
        v-show="tab.id === activeTabId"
        class="absolute inset-0"
      >
        <TerminalPane
          v-if="tab.type === 'terminal'"
          ref="terminalPanes"
          :container-id="tab.containerId"
          :is-active="tab.id === activeTabId"
          :is-focused="isFocused"
          @focus-group="emit('focusGroup')"
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
      </div>
    </template>
    <TerminalPlaceholder v-if="!group.tabs.length" />
  </div>
</template>
