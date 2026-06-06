<script setup lang="ts">
import type { ContainerInfo, PortMapping, DomainMapping, RepoConfig, MountConfig, UpdateContainerSettingsRequest } from '~/types';
import type { AppInstanceInfo } from '../../shared/types';

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

const props = defineProps<{
  container: ContainerInfo;
  statusColor: BadgeColor;
}>();

const emit = defineEmits<{
  update: [id: string, patch: UpdateContainerSettingsRequest, rebuild: boolean];
  rebuild: [id: string];
}>();

const open = defineModel<boolean>('open', { default: false });

const { gitProviders } = useGitProviders();
const { environments, defaultEnvironmentId } = useEnvironments();
const { initScripts } = useInitScripts();

const displayLabel = computed(() => props.container.displayName || shortName(props.container.id));

// ─── Editable settings form ──────────────────────────────────────────────
// `displayName` is a live edit (applied without rebuild). `environmentId`,
// `repos`, `mounts`, and `initScript` are baked into the container at create
// time, so editing them flags the worker `pendingRebuild` until the next
// rebuild — surfaced via the per-field "requires rebuild" badges below.
const form = reactive({
  displayName: '',
  environmentId: '',
  repos: [] as RepoConfig[],
  mounts: [] as MountConfig[],
  initScript: '',
});

const { selectedPreset, presetOptions } = useInitScriptSync(initScripts, toRef(form, 'initScript'));

const environmentOptions = computed(() => environments.value.map((e) => ({ label: e.name, value: e.id })));
const defaultProvider = computed(() => gitProviders.value[0]?.id || 'github');

function resetFormFromContainer() {
  form.displayName = props.container.displayName || '';
  form.environmentId = props.container.environmentId || defaultEnvironmentId.value;
  form.repos = (props.container.repos || []).map((r) => ({ ...r }));
  form.mounts = (props.container.mounts || []).map((m) => ({ ...m }));
  form.initScript = props.container.initScript || '';
}

function addRepo() {
  form.repos.push({ provider: defaultProvider.value, url: '', branch: '' });
}
function removeRepo(idx: number) {
  form.repos.splice(idx, 1);
}
function addMount() {
  form.mounts.push({ source: '', target: '', readOnly: false });
}
function removeMount(idx: number) {
  form.mounts.splice(idx, 1);
}

// ─── Dirty / validity tracking ───────────────────────────────────────────
function normRepos(repos: RepoConfig[] | undefined): string {
  return JSON.stringify((repos ?? []).filter((r) => r.url).map((r) => ({ provider: r.provider, url: r.url, branch: r.branch || '' })));
}
function normMounts(mounts: MountConfig[] | undefined): string {
  return JSON.stringify((mounts ?? []).filter((m) => m.source && m.target).map((m) => ({ source: m.source, target: m.target, readOnly: !!m.readOnly })));
}

const liveDirty = computed(() => {
  const next = form.displayName.trim();
  return !!next && next !== (props.container.displayName || '');
});
const envDirty = computed(() => form.environmentId !== (props.container.environmentId || defaultEnvironmentId.value));
const initDirty = computed(() => (form.initScript.trim() || '') !== (props.container.initScript || ''));
const reposDirty = computed(() => normRepos(form.repos) !== normRepos(props.container.repos));
const mountsDirty = computed(() => normMounts(form.mounts) !== normMounts(props.container.mounts));
const rebuildDirty = computed(() => envDirty.value || initDirty.value || reposDirty.value || mountsDirty.value);
const anyDirty = computed(() => liveDirty.value || rebuildDirty.value);

const nameValid = computed(() => {
  const n = form.displayName.trim();
  return n.length > 0 && n.length <= 100;
});
const canSave = computed(() => anyDirty.value && nameValid.value);

function buildPatch(): UpdateContainerSettingsRequest {
  return {
    displayName: form.displayName.trim(),
    environmentId: form.environmentId,
    // Trim to match the `initDirty` baseline — the dirty-check compares
    // `form.initScript.trim()`, so persist the same trimmed value (trailing
    // whitespace in a bash script is harmless) instead of drifting.
    initScript: form.initScript.trim(),
    repos: form.repos
      .filter((r) => r.url)
      .map((r) => ({ provider: r.provider, url: r.url, ...(r.branch ? { branch: r.branch } : {}) })),
    mounts: form.mounts
      .filter((m) => m.source && m.target)
      .map((m) => ({ source: m.source, target: m.target, ...(m.readOnly ? { readOnly: true } : {}) })),
  };
}

function save(rebuild: boolean) {
  if (!canSave.value) return;
  emit('update', props.container.id, buildPatch(), rebuild);
  open.value = false;
}

function rebuildNow() {
  emit('rebuild', props.container.id);
  open.value = false;
}

// ─── Read-only info sections ─────────────────────────────────────────────
const portMappings = ref<PortMapping[]>([]);
const domainMappings = ref<DomainMapping[]>([]);
const appInstances = ref<AppInstanceInfo[]>([]);
const loaded = ref(false);

async function loadDetails() {
  if (loaded.value) return;
  loaded.value = true;

  const fetches: Promise<void>[] = [];

  fetches.push(
    $fetch<PortMapping[]>('/api/port-mappings')
      .then((all) => { portMappings.value = all.filter((m) => m.containerName === props.container.containerName); })
      .catch(() => {}),
  );

  fetches.push(
    $fetch<DomainMapping[]>('/api/domain-mappings')
      .then((all) => { domainMappings.value = all.filter((m) => m.containerName === props.container.containerName); })
      .catch(() => {}),
  );

  if (props.container.status === 'running') {
    fetches.push(
      $fetch<AppInstanceInfo[]>(`/api/containers/${props.container.id}/apps`)
        .then((apps) => { appInstances.value = apps; })
        .catch(() => {}),
    );
  }

  await Promise.all(fetches);
}

watch(open, (isOpen) => {
  if (isOpen) {
    resetFormFromContainer();
    loadDetails();
  }
});

watch(() => props.container.id, () => {
  portMappings.value = [];
  domainMappings.value = [];
  appInstances.value = [];
  loaded.value = false;
  if (open.value) {
    resetFormFromContainer();
    loadDetails();
  }
});

const shortImageId = computed(() => {
  const id = props.container.imageId || '';
  return id.replace('sha256:', '').slice(0, 12);
});

const formattedCreatedAt = computed(() => {
  if (!props.container.createdAt) return '—';
  return new Date(props.container.createdAt).toLocaleString();
});
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-2xl' }">
    <template #content>
      <div class="p-5 max-h-[90vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-center justify-between mb-5 gap-3">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white truncate" :title="displayLabel">
            {{ displayLabel }}
            <span class="text-gray-400 dark:text-gray-500 font-normal">— Settings</span>
          </h2>
          <div class="flex items-center gap-1.5 shrink-0">
            <UBadge v-if="container.pendingRebuild" color="warning" variant="subtle" size="sm">
              Rebuild pending
            </UBadge>
            <UBadge :color="statusColor" variant="subtle" size="sm">
              {{ container.status }}
            </UBadge>
          </div>
        </div>

        <!-- Pending rebuild banner -->
        <div
          v-if="container.pendingRebuild"
          class="mb-5 flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2"
        >
          <span class="text-xs text-amber-700 dark:text-amber-300">
            Settings changes are saved but not yet applied. Rebuild to apply them to the running worker.
          </span>
          <UButton size="xs" color="warning" variant="solid" icon="i-lucide-hammer" @click="rebuildNow">
            Rebuild now
          </UButton>
        </div>

        <div class="space-y-5">
          <!-- Worker identity (read-only) -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Worker</h3>
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt class="text-gray-500 dark:text-gray-400">Worker ID</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs truncate" :title="container.id">{{ container.id }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Container ID</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs truncate" :title="container.containerId">{{ container.containerId.slice(0, 12) }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Image</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs truncate" :title="container.imageName">{{ container.imageName }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Image ID</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs truncate" :title="container.imageId">{{ shortImageId || '—' }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Created</dt>
              <dd class="text-gray-900 dark:text-white text-xs">{{ formattedCreatedAt }}</dd>
            </dl>
          </section>

          <!-- Editable settings -->
          <section class="space-y-4">
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Settings</h3>

            <!-- Display name (live) -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Display name</label>
                <UBadge color="success" variant="subtle" size="xs">no rebuild needed</UBadge>
              </div>
              <UInput v-model="form.displayName" class="w-full" placeholder="Worker label" />
              <p v-if="!nameValid" class="text-xs text-red-500 mt-1">Name must be 1–100 characters.</p>
            </div>

            <!-- Environment (rebuild) -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Environment</label>
                <UBadge color="warning" variant="subtle" size="xs">requires rebuild</UBadge>
              </div>
              <USelect v-model="form.environmentId" :items="environmentOptions" class="w-full" />
            </div>

            <!-- Repositories (rebuild) -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Repositories</label>
                <UBadge color="warning" variant="subtle" size="xs">requires rebuild</UBadge>
              </div>
              <div class="space-y-2">
                <RepoInput
                  v-for="(repo, idx) in form.repos"
                  :key="idx"
                  :model-value="repo"
                  :providers="gitProviders"
                  @update:model-value="form.repos[idx] = $event"
                  @remove="removeRepo(idx)"
                />
              </div>
              <UButton size="xs" variant="link" class="mt-1" @click="addRepo">+ Add repository</UButton>
            </div>

            <!-- Volume mounts (rebuild) -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Volume Mounts</label>
                <UBadge color="warning" variant="subtle" size="xs">requires rebuild</UBadge>
              </div>
              <div class="space-y-2">
                <MountInput
                  v-for="(mount, idx) in form.mounts"
                  :key="idx"
                  :model-value="mount"
                  @update:model-value="form.mounts[idx] = $event"
                  @remove="removeMount(idx)"
                />
              </div>
              <UButton size="xs" variant="link" class="mt-1" @click="addMount">+ Add mount</UButton>
            </div>

            <!-- Init script (rebuild) -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-sm font-medium text-gray-700 dark:text-gray-300">Init Script</label>
                <UBadge color="warning" variant="subtle" size="xs">requires rebuild</UBadge>
              </div>
              <div class="space-y-2">
                <USelect v-model="selectedPreset" :items="presetOptions" class="w-full" />
                <UTextarea
                  v-model="form.initScript"
                  :rows="3"
                  placeholder="#!/bin/bash&#10;# Script to run in tmux on startup"
                  class="w-full font-mono text-xs"
                />
              </div>
            </div>

            <!-- Save actions -->
            <div class="flex items-center gap-2 pt-1">
              <UButton :disabled="!canSave" @click="save(false)">Save</UButton>
              <UButton
                v-if="rebuildDirty"
                color="warning"
                variant="solid"
                icon="i-lucide-hammer"
                :disabled="!canSave"
                @click="save(true)"
              >
                Save &amp; Rebuild
              </UButton>
              <span v-if="rebuildDirty" class="text-xs text-amber-600 dark:text-amber-400">
                Changes require a rebuild to take effect.
              </span>
              <div class="flex-1" />
              <UButton color="neutral" variant="outline" @click="open = false">Close</UButton>
            </div>
          </section>

          <!-- Port Mappings (read-only) -->
          <section v-if="portMappings.length > 0">
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Port Mappings</h3>
            <div class="space-y-1.5">
              <div v-for="pm in portMappings" :key="pm.externalPort" class="flex items-center gap-2 text-sm">
                <span class="font-mono text-xs text-gray-900 dark:text-white">:{{ pm.externalPort }}</span>
                <span class="text-gray-400">&rarr;</span>
                <span class="font-mono text-xs text-gray-900 dark:text-white">:{{ pm.internalPort }}</span>
                <UBadge :color="pm.type === 'external' ? 'warning' : 'neutral'" variant="subtle" size="xs">
                  {{ pm.type }}
                </UBadge>
                <span v-if="pm.appType" class="text-gray-400 text-xs">{{ pm.appType }}</span>
              </div>
            </div>
          </section>

          <!-- Domain Mappings (read-only) -->
          <section v-if="domainMappings.length > 0">
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Domain Mappings</h3>
            <div class="space-y-1.5">
              <div v-for="dm in domainMappings" :key="dm.id" class="flex items-center gap-2 text-sm">
                <span class="font-mono text-xs text-gray-900 dark:text-white truncate">{{ dm.subdomain }}.{{ dm.baseDomain }}</span>
                <span class="text-gray-400">&rarr;</span>
                <span class="font-mono text-xs text-gray-900 dark:text-white">:{{ dm.internalPort }}</span>
                <UBadge color="neutral" variant="subtle" size="xs">{{ dm.protocol }}</UBadge>
                <UBadge v-if="dm.basicAuth" color="warning" variant="subtle" size="xs">auth</UBadge>
              </div>
            </div>
          </section>

          <!-- App Instances (read-only) -->
          <section v-if="appInstances.length > 0">
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">App Instances</h3>
            <div class="space-y-1.5">
              <div v-for="app in appInstances" :key="app.id" class="flex items-center gap-2 text-sm">
                <span class="text-gray-900 dark:text-white text-xs">{{ app.appType }}</span>
                <span class="font-mono text-xs text-gray-400">:{{ app.port }}</span>
                <UBadge :color="app.status === 'running' ? 'success' : 'neutral'" variant="subtle" size="xs">
                  {{ app.status }}
                </UBadge>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>
  </UModal>
</template>
