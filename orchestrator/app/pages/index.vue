<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import type { ContainerInfo, CreateContainerRequest, UpdateContainerSettingsRequest } from '~/types';

useHead({ title: 'Agentor' });

const toast = useToast();
const { gitProviders } = useGitProviders();
const { containers, refresh: refreshContainers, createContainer, stopContainer, restartContainer, rebuildContainer, removeContainer, updateContainerSettings } = useContainers();
const { archivedWorkers, refresh: refreshArchived, archiveWorker, unarchiveWorker, deleteArchivedWorker } = useArchivedWorkers();
const {
  rootNode,
  focusedNodeId,
  tabs,
  activeTabId,
  openTab,
  closeTab,
  closeTabsForContainer,
  renameContainerTabs,
  focusGroup,
  moveTab,
  splitWithTab,
  resizeNodes,
  activateTab,
} = useSplitPanes();

// Shared state: the empty-pane placeholder opens the same modal.
const showCreateModal = useState<boolean>('create-worker-modal-open', () => false);
const showImportModal = ref(false);
const showEnvironmentsModal = ref(false);
const showCapabilitiesModal = ref(false);
const showInstructionsModal = ref(false);
const showInitScriptsModal = ref(false);
const showSettingsModal = ref(false);
const showUsersModal = ref(false);
const showAccountModal = ref(false);

const {
  sidebarWidth,
  isDragging,
  isCollapsed,
  isMobile,
  minWidth: sidebarMinWidth,
  maxWidth: sidebarMaxWidth,
  keyboardStep: sidebarKeyboardStep,
  startDrag,
  nudgeWidth,
  toggleCollapse,
} = useSidebarResize();

const sidebarRef = ref<ComponentPublicInstance | null>(null);
const expandButtonRef = ref<HTMLButtonElement | null>(null);

function sidebarElement(): HTMLElement | null {
  return (sidebarRef.value?.$el as HTMLElement | undefined) ?? null;
}

// The control that had focus becomes inert (collapsed sidebar) or unmounts
// (expand button), so hand focus to the toggle that replaced it. Not the first
// button in the sidebar: the theme buttons sit in tooltips, which open on focus.
function focusSidebarToggle() {
  nextTick(() => {
    if (isCollapsed.value) {
      expandButtonRef.value?.focus();
    } else {
      sidebarElement()?.querySelector<HTMLElement>('button[title="Collapse sidebar"]')?.focus();
    }
  });
}

function toggleSidebar() {
  toggleCollapse();
  focusSidebarToggle();
}

/** The phone overlay covers the panes, so get it out of the way once a pane opens. */
function closeSidebarOnMobile() {
  if (!isMobile.value || isCollapsed.value) return;
  toggleCollapse();
  nextTick(() => {
    // Leave focus alone when the new pane already took it.
    const active = document.activeElement;
    if (!active || active === document.body || sidebarElement()?.contains(active)) {
      expandButtonRef.value?.focus();
    }
  });
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (!isMobile.value || isCollapsed.value) return;
  // A modal opened from the overlay closes first; the overlay stays. Only an
  // open modal (or a dialog holding focus) counts — a terminal text view in a
  // hidden pane tab must not swallow Escape.
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[role="dialog"]') || document.querySelector('[role="dialog"][data-state="open"]')) return;
  toggleSidebar();
}

function onSidebarHandleKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  nudgeWidth(event.key === 'ArrowRight' ? sidebarKeyboardStep : -sidebarKeyboardStep);
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown));
onUnmounted(() => document.removeEventListener('keydown', onDocumentKeydown));

// Worker ids with a lifecycle action in flight (the card shows a spinner).
const busyIds = reactive(new Set<string>());

/** True (and tells the user) when another action for this worker is still running. */
function isBusy(id: string, label: string): boolean {
  if (!busyIds.has(id)) return false;
  toast.add({
    title: `${label} not started`,
    description: 'Another action for this worker is still running — try again when it has finished.',
    color: 'warning',
    icon: 'i-lucide-loader-circle',
  });
  return true;
}

/** Runs a worker action: ignores repeats while one is in flight for the same
 * worker and reports failures as a toast. `id` null = not tied to a worker. */
async function runAction(id: string | null, label: string, fn: () => Promise<unknown>) {
  if (id !== null) {
    if (isBusy(id, label)) return;
    busyIds.add(id);
  }
  try {
    await fn();
  } catch (err) {
    console.warn(`[agentor] ${label} failed`, err);
    toast.add({
      title: `${label} failed`,
      description: fetchErrorMessage(err, `${label} failed`),
      color: 'error',
      icon: 'i-lucide-alert-circle',
    });
  } finally {
    if (id !== null) busyIds.delete(id);
  }
}

function handleOpenLogs() {
  openTab('__logs__', 'Logs', 'logs');
  closeSidebarOnMobile();
}

function handleOpenTab(containerId: string, type: 'terminal' | 'desktop' | 'apps' | 'editor') {
  const container = containers.value.find((c) => c.id === containerId);
  const name = container?.displayName || shortName(container?.id || containerId.slice(0, 12));
  openTab(containerId, name, type);
  closeSidebarOnMobile();
}

function handleCreate(request: CreateContainerRequest) {
  return runAction(null, 'Create worker', async () => {
    const container = await createContainer(request);
    // Auto-open terminal tab immediately — the container is already starting
    if (container) handleOpenTab(container.id, 'terminal');
  });
}

function handleStop(id: string) {
  return runAction(id, 'Stop', () => stopContainer(id));
}

function handleRestart(id: string) {
  return runAction(id, 'Restart', () => restartContainer(id));
}

function handleDownloadWorkspace(id: string) {
  const link = document.createElement('a');
  link.href = `/api/containers/${id}/workspace`;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function onWorkerImported(container: ContainerInfo) {
  return runAction(null, 'Refresh workers', async () => {
    await refreshContainers();
    if (container) handleOpenTab(container.id, 'terminal');
  });
}

// The busy check runs before confirm() so a second click while the action is
// still running does not ask again for an action that will be ignored.
function handleRebuild(id: string) {
  if (isBusy(id, 'Rebuild')) return;
  if (!confirm('Rebuild this worker? The container will be destroyed and recreated with the latest image. Workspace data is preserved.')) return;
  return runAction(id, 'Rebuild', async () => {
    closeTabsForContainer(id);
    const rebuilt = await rebuildContainer(id);
    if (rebuilt) handleOpenTab(rebuilt.id, 'terminal');
  });
}

function handleRemove(id: string) {
  if (isBusy(id, 'Remove')) return;
  if (!confirm('Remove this container and delete all workspace data? This cannot be undone.')) return;
  return runAction(id, 'Remove', async () => {
    closeTabsForContainer(id);
    await removeContainer(id);
    await refreshArchived();
  });
}

function handleArchive(id: string) {
  if (isBusy(id, 'Archive')) return;
  if (!confirm('Archive this worker? The container will be removed but workspace data will be preserved.')) return;
  return runAction(id, 'Archive', async () => {
    closeTabsForContainer(id);
    await archiveWorker(id);
    await refreshContainers();
  });
}

function handleUpdate(id: string, patch: UpdateContainerSettingsRequest, rebuild: boolean) {
  return runAction(id, rebuild ? 'Save & rebuild' : 'Save settings', async () => {
    const updated = await updateContainerSettings(id, patch);
    // Open tab labels are captured at open time — refresh them in place when the
    // display name (a live edit) changed.
    if (patch.displayName && updated) {
      renameContainerTabs(id, updated.displayName || patch.displayName);
    }
    // Rebuild-requiring edits only take effect after a rebuild. When the user
    // chose "Save & Rebuild", apply them now (no confirm — the choice is explicit).
    if (rebuild) {
      closeTabsForContainer(id);
      const rebuilt = await rebuildContainer(id);
      if (rebuilt) handleOpenTab(rebuilt.id, 'terminal');
    }
  });
}

function handleUnarchive(id: string) {
  return runAction(id, 'Unarchive', async () => {
    await unarchiveWorker(id);
    await refreshContainers();
  });
}

function handleDeleteArchived(id: string) {
  if (isBusy(id, 'Delete')) return;
  if (!confirm('Permanently delete this archived worker? All workspace data will be lost.')) return;
  return runAction(id, 'Delete', () => deleteArchivedWorker(id));
}

// Cross-modal navigation: CreateContainerModal's "Manage" buttons close the
// current modal and queue a follow-up modal to open once the exit transition
// finishes (UModal emits `after:leave` when that is safe). Setting the next
// modal before the transition completes would stack their backdrops.
const pendingModalAfterCreateClose = ref<'environments' | 'initScripts' | null>(null);

function openEnvironmentsFromModal() {
  pendingModalAfterCreateClose.value = 'environments';
  showCreateModal.value = false;
}

function openInitScriptsFromModal() {
  pendingModalAfterCreateClose.value = 'initScripts';
  showCreateModal.value = false;
}

function onCreateModalClosed() {
  const next = pendingModalAfterCreateClose.value;
  pendingModalAfterCreateClose.value = null;
  if (next === 'environments') showEnvironmentsModal.value = true;
  else if (next === 'initScripts') showInitScriptsModal.value = true;
}

</script>

<template>
  <!-- `isolate` keeps the shell's z-indexes (overlay, backdrop, expand button)
       below the body-level portals of modals, menus and tooltips. -->
  <div class="app-shell isolate flex bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-200">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:px-3 focus:py-2 focus:rounded-md focus:bg-white dark:focus:bg-gray-900"
    >Skip to panes</a>

    <!-- Mobile backdrop -->
    <div
      v-if="isMobile && !isCollapsed"
      class="sidebar-backdrop"
      @click="toggleSidebar"
    />

    <!-- Sidebar -->
    <AppSidebar
      ref="sidebarRef"
      :inert="isCollapsed"
      :style="{ width: isCollapsed ? '0px' : sidebarWidth + 'px' }"
      :class="[
        'sidebar-panel',
        {
          'sidebar-collapsed': isCollapsed,
          'sidebar-mobile': isMobile,
          'sidebar-dragging': isDragging,
        },
      ]"
      :containers="containers"
      :tabs="tabs"
      :active-tab-id="activeTabId"
      :archived-workers="archivedWorkers"
      :busy-ids="busyIds"
      @new-worker="showCreateModal = true"
      @import-worker="showImportModal = true"
      @manage-environments="showEnvironmentsModal = true"
      @manage-capabilities="showCapabilitiesModal = true"
      @manage-instructions="showInstructionsModal = true"
      @manage-init-scripts="showInitScriptsModal = true"
      @open-terminal="(cid) => handleOpenTab(cid, 'terminal')"
      @open-desktop="(cid) => handleOpenTab(cid, 'desktop')"
      @open-apps="(cid) => handleOpenTab(cid, 'apps')"
      @open-editor="(cid) => handleOpenTab(cid, 'editor')"
      @stop-container="handleStop"
      @restart-container="handleRestart"
      @rebuild-container="handleRebuild"
      @remove-container="handleRemove"
      @archive-container="handleArchive"
      @update-container="handleUpdate"
      @download-workspace="handleDownloadWorkspace"
      @unarchive-worker="handleUnarchive"
      @delete-archived-worker="handleDeleteArchived"
      @open-settings="showSettingsModal = true"
      @open-logs="handleOpenLogs"
      @open-users="showUsersModal = true"
      @open-account="showAccountModal = true"
      @toggle-collapse="toggleSidebar"
    />

    <!-- Sidebar resize handle -->
    <div
      v-if="!isCollapsed && !isMobile"
      class="sidebar-handle"
      :class="{ dragging: isDragging }"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      tabindex="0"
      :aria-valuenow="sidebarWidth"
      :aria-valuemin="sidebarMinWidth"
      :aria-valuemax="sidebarMaxWidth"
      :aria-valuetext="`${sidebarWidth} pixels`"
      @pointerdown="startDrag"
      @keydown="onSidebarHandleKeydown"
    />

    <!-- Collapsed sidebar expand button -->
    <button
      v-if="isCollapsed"
      ref="expandButtonRef"
      type="button"
      class="sidebar-expand-fab"
      title="Expand sidebar"
      aria-expanded="false"
      @click="toggleSidebar"
    >
      <UIcon name="i-lucide-menu" class="size-4" />
    </button>

    <!-- Main content (the leading inset keeps the first pane tab clear of the expand button) -->
    <main
      id="main-content"
      tabindex="-1"
      class="flex-1 flex min-w-0 min-h-0 focus:outline-none"
      :inert="isMobile && !isCollapsed"
      :style="isCollapsed ? { '--pane-leading-inset': '40px' } : undefined"
    >
      <SplitPaneLayout
        :root-node="rootNode"
        :focused-node-id="focusedNodeId"
        @activate-tab="activateTab"
        @close-tab="closeTab"
        @focus-node="focusGroup"
        @resize="resizeNodes"
        @move-tab="moveTab"
        @split-with-tab="splitWithTab"
      />
    </main>

    <CreateContainerModal
      v-model:open="showCreateModal"
      :git-providers="gitProviders"
      @create="handleCreate"
      @manage-environments="openEnvironmentsFromModal"
      @manage-init-scripts="openInitScriptsFromModal"
      @after:leave="onCreateModalClosed"
    />

    <ImportWorkerModal
      v-model:open="showImportModal"
      @imported="onWorkerImported"
    />

    <EnvironmentsModal
      v-model:open="showEnvironmentsModal"
    />

    <CapabilitiesModal v-model:open="showCapabilitiesModal" />
    <InstructionsModal v-model:open="showInstructionsModal" />
    <InitScriptsModal v-model:open="showInitScriptsModal" />
    <SettingsModal v-model:open="showSettingsModal" />
    <UsersModal v-model:open="showUsersModal" />
    <AccountModal v-model:open="showAccountModal" />
  </div>
</template>
