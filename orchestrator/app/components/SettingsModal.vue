<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false });

interface SettingItem {
  key: string;
  label: string;
  value: string | number | boolean | string[] | null;
  type: 'string' | 'number' | 'boolean' | 'list' | 'status';
  sensitive?: boolean;
}

interface SettingSection {
  id: string;
  label: string;
  items: SettingItem[];
}

const { data: sections, status } = useFetch<SettingSection[]>('/api/settings', {
  default: () => [],
  watch: [open],
});

const expandedSections = ref<Set<string>>(new Set());

function toggleSection(id: string) {
  const s = new Set(expandedSections.value);
  if (s.has(id)) {
    s.delete(id);
  } else {
    s.add(id);
  }
  expandedSections.value = s;
}

function isSectionExpanded(id: string): boolean {
  return expandedSections.value.has(id);
}

// Expand all sections by default once loaded
watch(sections, (val) => {
  if (val.length > 0 && expandedSections.value.size === 0) {
    expandedSections.value = new Set(val.map((s) => s.id));
  }
}, { immediate: true });

function expandAll() {
  expandedSections.value = new Set(sections.value.map((s) => s.id));
}

function collapseAll() {
  expandedSections.value = new Set();
}

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

function statusColor(value: string): BadgeColor {
  return value === 'configured' ? 'success' : 'neutral';
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-3xl' }">
    <template #content>
      <div class="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">System Settings</h2>
          <div class="flex items-center gap-2">
            <button
              class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              @click="expandAll"
            >
              Expand all
            </button>
            <span class="text-gray-300 dark:text-gray-600">|</span>
            <button
              class="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              @click="collapseAll"
            >
              Collapse all
            </button>
          </div>
        </div>

        <p class="text-xs text-gray-500 dark:text-gray-400">
          Read-only view of all system configuration. Values are set via environment variables in
          <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">.env</code>.
        </p>

        <!-- Loading -->
        <div v-if="status === 'pending'" class="text-center py-8 text-gray-400">
          Loading settings...
        </div>

        <!-- Sections -->
        <div v-else class="space-y-2">
          <div
            v-for="section in sections"
            :key="section.id"
            class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
          >
            <!-- Section header -->
            <button
              class="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
              @click="toggleSection(section.id)"
            >
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-gray-900 dark:text-white">{{ section.label }}</span>
                <span class="text-xs text-gray-400 dark:text-gray-500">{{ section.items.length }} items</span>
              </div>
              <UIcon name="i-lucide-chevron-down" class="size-4 text-gray-400 transition-transform" :class="isSectionExpanded(section.id) ? '' : '-rotate-90'" />
            </button>

            <!-- Section items -->
            <div v-if="isSectionExpanded(section.id)" class="divide-y divide-gray-100 dark:divide-gray-800">
              <div
                v-for="item in section.items"
                :key="item.key"
                class="px-4 py-2.5 flex items-start gap-4"
              >
                <!-- Label -->
                <div class="flex-shrink-0 w-48 min-w-0">
                  <span class="text-xs font-medium text-gray-600 dark:text-gray-300 break-words">{{ item.label }}</span>
                  <div class="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate" :title="item.key">
                    {{ item.key }}
                  </div>
                </div>

                <!-- Value -->
                <div class="flex-1 min-w-0">
                  <!-- Status badge -->
                  <template v-if="item.type === 'status'">
                    <UBadge
                      :color="statusColor(String(item.value))"
                      variant="subtle"
                      size="xs"
                    >
                      {{ item.value }}
                    </UBadge>
                  </template>

                  <!-- Boolean -->
                  <template v-else-if="item.type === 'boolean'">
                    <UBadge
                      :color="item.value ? 'success' : 'neutral'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ item.value ? 'enabled' : 'disabled' }}
                    </UBadge>
                  </template>

                  <!-- List -->
                  <template v-else-if="item.type === 'list' && Array.isArray(item.value)">
                    <div class="flex flex-wrap gap-1">
                      <span
                        v-for="(v, i) in item.value"
                        :key="i"
                        class="inline-block text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded font-mono"
                      >
                        {{ v }}
                      </span>
                    </div>
                  </template>

                  <!-- String / Number -->
                  <template v-else>
                    <span class="text-xs text-gray-700 dark:text-gray-200 font-mono break-all">
                      {{ item.value ?? '—' }}
                    </span>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex justify-end pt-2">
          <UButton color="neutral" variant="outline" size="sm" @click="open = false">
            Close
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
