<script setup lang="ts">
import type { ContainerInfo, Tab, ArchivedWorker } from '~/types';

const props = defineProps<{
  containers: ContainerInfo[];
  tabs: Tab[];
  activeTabId: string | null;
  archivedWorkers: ArchivedWorker[];
}>();

const emit = defineEmits<{
  newWorker: [];
  manageEnvironments: [];
  manageCapabilities: [];
  manageInstructions: [];
  manageInitScripts: [];
  openTerminal: [containerId: string];
  openDesktop: [containerId: string];
  openApps: [containerId: string];
  openEditor: [containerId: string];
  openVsCode: [containerId: string];
  stopContainer: [id: string];
  restartContainer: [id: string];
  rebuildContainer: [id: string];
  removeContainer: [id: string];
  archiveContainer: [id: string];
  downloadWorkspace: [id: string];
  unarchiveWorker: [name: string];
  deleteArchivedWorker: [name: string];
  openSettings: [];
  openLogs: [];
  openUsers: [];
  openAccount: [];
  toggleCollapse: [];
}>();

const { user: currentUser, isAdmin, signOut } = useAuth();

const { state: uiState, setActiveTab } = useUiState();
const { refreshing: usageRefreshing, refresh: usageRefresh } = useUsage();
const { mappings: portMappings } = usePortMappings();
const { mappings: domainMappings } = useDomainMappings();

const { data: domainMapperStatus } = useFetch<{ enabled: boolean }>('/api/domain-mapper/status', {
  default: () => ({ enabled: false }),
});

interface SidebarTabDef {
  id: string;
  label: string;
  icon: string;
  badge?: number;
}

const visibleTabs = computed<SidebarTabDef[]>(() => {
  const items: SidebarTabDef[] = [
    { id: 'workers', label: 'Workers', icon: 'i-lucide-server', badge: props.containers.length || undefined },
    { id: 'archived', label: 'Archived', icon: 'i-lucide-archive', badge: props.archivedWorkers.length || undefined },
    { id: 'ports', label: 'Ports', icon: 'i-lucide-plug', badge: portMappings.value.length || undefined },
  ];
  if (domainMapperStatus.value.enabled) {
    items.push({ id: 'domains', label: 'Domains', icon: 'i-lucide-globe', badge: domainMappings.value.length || undefined });
  }
  items.push({ id: 'usage', label: 'Usage', icon: 'i-lucide-activity' });
  // System tab (Images + Logs + System Settings + Users) is admin-only —
  // every action inside it calls an admin-only endpoint.
  if (isAdmin.value) {
    items.push({ id: 'system', label: 'System', icon: 'i-lucide-settings' });
  }
  return items;
});

const activeTab = computed(() => {
  const validIds = visibleTabs.value.map((t) => t.id);
  return validIds.includes(uiState.value.sidebar.activeTab)
    ? uiState.value.sidebar.activeTab
    : 'workers';
});

function selectTab(id: string) {
  setActiveTab(id);
  moreOpen.value = false;
}

// --- Overflow handling ---
// The tab bar is horizontally scrollable. Tabs that are not fully within the
// current scroll viewport also get listed in a dropdown accessible from a
// "More" button pinned to the right edge. When the sidebar is wide enough
// that every tab fits (no overflow), the dropdown disappears entirely.
const tabBarRef = ref<HTMLElement>();
const moreContainerRef = ref<HTMLElement>();
const moreOpen = ref(false);
const hasOverflow = ref(false);
const overflowingIds = ref<Set<string>>(new Set());

const overflowingTabs = computed(() =>
  visibleTabs.value.filter((t) => overflowingIds.value.has(t.id)),
);
const activeInOverflow = computed(() => overflowingIds.value.has(activeTab.value));

function setsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function recalcOverflow() {
  const bar = tabBarRef.value;
  if (!bar) return;

  // Allow 1px tolerance to avoid flapping on sub-pixel rounding. When the
  // bar content fits entirely we skip the per-tab check altogether — every
  // tab is 100% visible so nothing can overflow.
  const hasScrollOverflow = bar.scrollWidth - bar.clientWidth > 1;
  if (!hasScrollOverflow) {
    hasOverflow.value = false;
    if (overflowingIds.value.size > 0) overflowingIds.value = new Set();
    if (moreOpen.value) moreOpen.value = false;
    return;
  }

  const viewLeft = bar.scrollLeft;
  const viewRight = viewLeft + bar.clientWidth;
  const next = new Set<string>();
  const children = Array.from(bar.querySelectorAll<HTMLElement>('[data-tab-id]'));
  // A tab is listed in the overflow dropdown only if LESS THAN 20% of its
  // width is currently visible inside the scroll viewport. A tab with 20% or
  // more visible stays out of the dropdown — this gives a small hysteresis
  // zone so tabs don't pop in/out while scrolling past them.
  const VISIBLE_THRESHOLD = 0.2;
  for (const el of children) {
    const id = el.dataset.tabId;
    if (!id) continue;
    const left = el.offsetLeft;
    const width = el.offsetWidth;
    if (width <= 0) continue;
    const right = left + width;
    const visibleLeft = Math.max(left, viewLeft);
    const visibleRight = Math.min(right, viewRight);
    const visibleWidth = Math.max(0, visibleRight - visibleLeft);
    if (visibleWidth / width < VISIBLE_THRESHOLD) {
      next.add(id);
    }
  }
  if (!setsEqual(next, overflowingIds.value)) {
    overflowingIds.value = next;
  }
  // The More button + padding only show when there's actually something to
  // drop down. If the user scrolls such that every tab is at least 20%
  // visible, the button (and its gradient overlay) disappear.
  hasOverflow.value = next.size > 0;
  if (next.size === 0 && moreOpen.value) moreOpen.value = false;
}

let scrollRaf = 0;
function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    recalcOverflow();
  });
}

// Convert vertical mouse-wheel into horizontal scroll on the tab bar so
// mouse users (not just trackpad users) can reach overflowed tabs without
// having to open the More dropdown every time.
function onTabBarWheel(e: WheelEvent) {
  const bar = tabBarRef.value;
  if (!bar) return;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  bar.scrollLeft += e.deltaY;
  e.preventDefault();
}

function onClickOutside(e: MouseEvent) {
  if (moreContainerRef.value && !moreContainerRef.value.contains(e.target as Node)) {
    moreOpen.value = false;
  }
}

watch(moreOpen, (open) => {
  if (open) {
    document.addEventListener('mousedown', onClickOutside);
  } else {
    document.removeEventListener('mousedown', onClickOutside);
  }
});

let resizeObs: ResizeObserver | null = null;

onMounted(() => {
  nextTick(recalcOverflow);
  if (tabBarRef.value) {
    resizeObs = new ResizeObserver(() => recalcOverflow());
    resizeObs.observe(tabBarRef.value);
  }
});

onUnmounted(() => {
  resizeObs?.disconnect();
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  document.removeEventListener('mousedown', onClickOutside);
});

watch(visibleTabs, () => nextTick(recalcOverflow));

function isContainerActive(containerId: string, tabs: Tab[], activeTabId: string | null): boolean {
  if (!activeTabId) return false;
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab?.containerId === containerId;
}
</script>

<template>
  <aside class="relative bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col flex-shrink-0 min-w-0">
    <!-- Header -->
    <div class="p-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-bold text-gray-900 dark:text-white">Agentor</h1>
        <div class="flex items-center gap-1">
          <ThemeToggle />
          <button
            class="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            title="Collapse sidebar"
            @click="emit('toggleCollapse')"
          >
            <UIcon name="i-lucide-chevrons-left" class="size-4" />
          </button>
        </div>
      </div>
      <p class="text-xs text-gray-500 mt-0.5">Orchestrator</p>
      <UButton class="w-full mt-3" @click="emit('newWorker')">
        + New Worker
      </UButton>
      <UButton class="w-full mt-2" color="neutral" variant="outline" size="sm" @click="emit('manageEnvironments')">
        Environments
      </UButton>
      <div class="sidebar-btn-row-3-container mt-2">
        <div class="sidebar-btn-row-3">
          <UButton color="neutral" variant="outline" size="sm" @click="emit('manageCapabilities')">
            Capabilities
          </UButton>
          <UButton color="neutral" variant="outline" size="sm" @click="emit('manageInstructions')">
            Instructions
          </UButton>
          <UButton color="neutral" variant="outline" size="sm" @click="emit('manageInitScripts')">
            Init Scripts
          </UButton>
        </div>
      </div>
    </div>

    <!-- Tab bar area -->
    <div ref="moreContainerRef" class="sidebar-tab-bar-wrap" :class="{ 'has-overflow': hasOverflow }">
      <nav
        ref="tabBarRef"
        class="sidebar-tab-bar"
        @scroll.passive="onScroll"
        @wheel="onTabBarWheel"
      >
        <button
          v-for="tab in visibleTabs"
          :key="tab.id"
          :data-tab-id="tab.id"
          class="sidebar-tab"
          :class="{ 'sidebar-tab-active': activeTab === tab.id }"
          :title="tab.label"
          @click="selectTab(tab.id)"
        >
          <UIcon :name="tab.icon" class="size-3.5 flex-shrink-0" />
          <span class="sidebar-tab-label">{{ tab.label }}</span>
          <span v-if="tab.badge" class="sidebar-tab-badge">{{ tab.badge }}</span>
        </button>
      </nav>

      <!-- More button — only rendered when tabs actually overflow the bar. -->
      <button
        v-if="hasOverflow"
        class="sidebar-tab-more-btn"
        :class="{ 'sidebar-tab-active': activeInOverflow }"
        title="More tabs"
        @click="moreOpen = !moreOpen"
      >
        <UIcon name="i-lucide-chevrons-right" class="size-3.5" />
      </button>

      <!-- Dropdown lists only tabs not currently visible in the scroll viewport. -->
      <div v-if="moreOpen && hasOverflow && overflowingTabs.length > 0" class="sidebar-tab-dropdown">
        <button
          v-for="tab in overflowingTabs"
          :key="tab.id"
          class="sidebar-tab-dropdown-item"
          :class="{ 'sidebar-tab-dropdown-item-active': activeTab === tab.id }"
          @click="selectTab(tab.id)"
        >
          <UIcon :name="tab.icon" class="size-3.5 flex-shrink-0" />
          <span>{{ tab.label }}</span>
          <span v-if="tab.badge" class="sidebar-tab-dropdown-badge">{{ tab.badge }}</span>
        </button>
      </div>
    </div>

    <!-- Tab content -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <!-- Workers -->
      <div v-if="activeTab === 'workers'" class="p-3">
        <div v-if="containers.length === 0" class="text-gray-400 dark:text-gray-500 text-sm text-center py-8">
          No workers yet.
        </div>
        <div class="space-y-2">
          <ContainerCard
            v-for="c in containers"
            :key="c.id"
            :container="c"
            :is-active="isContainerActive(c.id, tabs, activeTabId)"
            @open-terminal="(cid) => emit('openTerminal', cid)"
            @open-desktop="(cid) => emit('openDesktop', cid)"
            @open-apps="(cid) => emit('openApps', cid)"
            @open-editor="(cid) => emit('openEditor', cid)"
            @open-vs-code="(cid) => emit('openVsCode', cid)"
            @stop="(id) => emit('stopContainer', id)"
            @restart="(id) => emit('restartContainer', id)"
            @rebuild="(id) => emit('rebuildContainer', id)"
            @remove="(id) => emit('removeContainer', id)"
            @archive="(id) => emit('archiveContainer', id)"
            @download-workspace="(id) => emit('downloadWorkspace', id)"
          />
        </div>
      </div>

      <!-- Archived -->
      <div v-if="activeTab === 'archived'" class="p-3">
        <div v-if="archivedWorkers.length === 0" class="text-gray-400 dark:text-gray-500 text-sm text-center py-8">
          No archived workers.
        </div>
        <div class="space-y-2">
          <ArchivedWorkerCard
            v-for="w in archivedWorkers"
            :key="w.name"
            :worker="w"
            @unarchive="(name) => emit('unarchiveWorker', name)"
            @delete="(name) => emit('deleteArchivedWorker', name)"
          />
        </div>
      </div>

      <!-- Port Mappings -->
      <div v-if="activeTab === 'ports'" class="p-3">
        <PortMappingsPanel :containers="containers" />
      </div>

      <!-- Domain Mappings -->
      <div v-if="activeTab === 'domains'" class="p-3">
        <DomainMappingsPanel :containers="containers" />
      </div>

      <!-- Usage -->
      <div v-if="activeTab === 'usage'" class="p-3 space-y-3">
        <UsagePanel />
        <!-- Actions card -->
        <div class="system-card">
          <div class="system-card-header">
            <UIcon name="i-lucide-zap" class="size-3.5" />
            <span>Actions</span>
          </div>
          <div class="p-1.5">
            <button
              class="system-card-link disabled:opacity-50"
              :disabled="usageRefreshing"
              @click="usageRefresh()"
            >
              <UIcon name="i-lucide-refresh-cw" class="size-3.5 flex-shrink-0" :class="{ 'animate-spin': usageRefreshing }" />
              {{ usageRefreshing ? 'Refreshing...' : 'Refresh usage' }}
            </button>
          </div>
        </div>
      </div>

      <!-- System (merged Images + Settings) -->
      <div v-if="activeTab === 'system'" class="p-3 space-y-3">
        <!-- Images card -->
        <div class="system-card">
          <div class="system-card-header">
            <UIcon name="i-lucide-box" class="size-3.5" />
            <span>Images</span>
          </div>
          <div class="px-3 py-2.5">
            <UpdateNotification />
          </div>
        </div>

        <!-- Quick links card -->
        <div class="system-card">
          <div class="system-card-header">
            <UIcon name="i-lucide-link" class="size-3.5" />
            <span>Quick Links</span>
          </div>
          <div class="p-1.5">
            <button
              class="system-card-link"
              @click="emit('openLogs')"
            >
              <UIcon name="i-lucide-scroll-text" class="size-3.5 flex-shrink-0" />
              Logs
            </button>
            <button
              class="system-card-link"
              @click="emit('openSettings')"
            >
              <UIcon name="i-lucide-sliders-horizontal" class="size-3.5 flex-shrink-0" />
              System Settings
            </button>
            <button
              v-if="isAdmin"
              class="system-card-link"
              @click="emit('openUsers')"
            >
              <UIcon name="i-lucide-users" class="size-3.5 flex-shrink-0" />
              Users
            </button>
            <a
              href="/api/docs"
              target="_blank"
              class="system-card-link"
            >
              <UIcon name="i-lucide-book-open" class="size-3.5 flex-shrink-0" />
              API Docs
              <UIcon name="i-lucide-external-link" class="size-3 flex-shrink-0 ml-auto opacity-40" />
            </a>
          </div>
        </div>

      </div>
    </div>

    <!-- Signed-in user card — pinned to the bottom of the sidebar -->
    <div class="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 p-3">
      <div class="flex items-center gap-2 min-w-0">
        <button
          type="button"
          class="flex items-center gap-2 min-w-0 flex-1 text-left rounded-md px-1 py-1 -mx-1 -my-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          title="Account settings"
          @click="emit('openAccount')"
        >
          <div class="flex items-center justify-center size-8 rounded-full bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-300 flex-shrink-0">
            <UIcon name="i-lucide-user" class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {{ (currentUser as any)?.name || 'User' }}
              </span>
              <UBadge v-if="isAdmin" size="xs" color="warning">admin</UBadge>
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
              {{ (currentUser as any)?.email }}
            </div>
          </div>
        </button>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-log-out"
          aria-label="Sign out"
          title="Sign out"
          class="flex-shrink-0"
          @click="signOut"
        />
      </div>
    </div>
  </aside>
</template>
