<script setup lang="ts">
import type { ContainerInfo, PortMapping, DomainMapping } from '~/types';
import type { AppInstanceInfo } from '../../shared/types';

const props = defineProps<{
  container: ContainerInfo;
  statusColor: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';
}>();

const open = defineModel<boolean>('open', { default: false });

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
      .then((all) => { portMappings.value = all.filter((m) => m.workerId === props.container.id); })
      .catch(() => {}),
  );

  fetches.push(
    $fetch<DomainMapping[]>('/api/domain-mappings')
      .then((all) => { domainMappings.value = all.filter((m) => m.workerId === props.container.id); })
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
  if (isOpen) loadDetails();
});

watch(() => props.container.id, () => {
  portMappings.value = [];
  domainMappings.value = [];
  appInstances.value = [];
  loaded.value = false;
});

const shortImageId = computed(() => {
  const id = props.container.imageId || '';
  return id.replace('sha256:', '').slice(0, 12);
});

const formattedCreatedAt = computed(() => {
  if (!props.container.createdAt) return '\u2014';
  return new Date(props.container.createdAt).toLocaleString();
});

const networkModeLabel = computed(() => {
  const labels: Record<string, string> = {
    'full': 'Full access',
    'block-all': 'Block all',
    'block': 'Block (custom allowlist)',
    'package-managers': 'Package managers only',
    'custom': 'Custom',
  };
  const mode = props.container.networkMode;
  return mode ? labels[mode] || mode : null;
});

const exposeApisLabels = computed(() => {
  const apis = props.container.exposeApis;
  if (!apis) return [];
  const result: string[] = [];
  if (apis.portMappings) result.push('Port Mappings');
  if (apis.domainMappings) result.push('Domain Mappings');
  if (apis.usage) result.push('Usage');
  return result;
});
</script>

<template>
  <UModal v-model:open="open">
    <template #content>
      <div class="p-5 max-h-[90vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-center justify-between mb-5">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white truncate mr-3">
            {{ container.displayName || shortName(container.name) }}
          </h2>
          <UBadge :color="statusColor" variant="subtle" size="sm" class="shrink-0">
            {{ container.status }}
          </UBadge>
        </div>

        <div class="space-y-5">
          <!-- Worker info -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Worker</h3>
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt class="text-gray-500 dark:text-gray-400">Container</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs">{{ shortName(container.name) }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Container ID</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs truncate" :title="container.id">{{ container.id.slice(0, 12) }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Image</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs truncate" :title="container.image">{{ container.image }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Image ID</dt>
              <dd class="text-gray-900 dark:text-white font-mono text-xs truncate" :title="container.imageId">{{ shortImageId || '\u2014' }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Created</dt>
              <dd class="text-gray-900 dark:text-white text-xs">{{ formattedCreatedAt }}</dd>
            </dl>
          </section>

          <!-- Configuration -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Configuration</h3>
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt class="text-gray-500 dark:text-gray-400">Environment</dt>
              <dd class="text-gray-900 dark:text-white">{{ container.environmentName || '\u2014' }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">CPU Limit</dt>
              <dd class="text-gray-900 dark:text-white">{{ container.cpuLimit ? `${container.cpuLimit} cores` : 'Unlimited' }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Memory Limit</dt>
              <dd class="text-gray-900 dark:text-white">{{ container.memoryLimit || 'Unlimited' }}</dd>

              <dt class="text-gray-500 dark:text-gray-400">Docker</dt>
              <dd class="text-gray-900 dark:text-white">{{ container.dockerEnabled ? 'Enabled' : 'Disabled' }}</dd>
            </dl>
          </section>

          <!-- Network -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Network</h3>
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt class="text-gray-500 dark:text-gray-400">Mode</dt>
              <dd class="text-gray-900 dark:text-white">{{ networkModeLabel || '\u2014' }}</dd>

              <template v-if="container.allowedDomains?.length">
                <dt class="text-gray-500 dark:text-gray-400">Allowed Domains</dt>
                <dd class="text-gray-900 dark:text-white">
                  <div v-for="domain in container.allowedDomains" :key="domain" class="font-mono text-xs">{{ domain }}</div>
                </dd>
              </template>

              <dt class="text-gray-500 dark:text-gray-400">Package Managers</dt>
              <dd class="text-gray-900 dark:text-white">{{ container.includePackageManagerDomains ? 'Allowed' : 'Blocked' }}</dd>
            </dl>
          </section>

          <!-- Repositories -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Repositories</h3>
            <template v-if="container.repos?.length">
              <div class="space-y-1">
                <div v-for="(repo, idx) in container.repos" :key="idx" class="text-sm">
                  <span class="text-gray-900 dark:text-white font-mono text-xs">{{ repo.url }}</span>
                  <span v-if="repo.branch" class="text-gray-400 ml-1.5 text-xs">@ {{ repo.branch }}</span>
                </div>
              </div>
            </template>
            <template v-else>
              <span class="text-xs text-gray-500 dark:text-gray-400 italic">None</span>
            </template>
          </section>

          <!-- Mounts -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Mounts</h3>
            <template v-if="container.mounts?.length">
              <div class="space-y-1">
                <div v-for="(mount, idx) in container.mounts" :key="idx" class="flex items-center gap-2 text-sm">
                  <span class="font-mono text-xs text-gray-900 dark:text-white truncate">{{ mount.source }}</span>
                  <span class="text-gray-400">&rarr;</span>
                  <span class="font-mono text-xs text-gray-900 dark:text-white truncate">{{ mount.target }}</span>
                  <UBadge v-if="mount.readOnly" color="neutral" variant="subtle" size="xs">ro</UBadge>
                </div>
              </div>
            </template>
            <template v-else>
              <span class="text-xs text-gray-500 dark:text-gray-400 italic">None</span>
            </template>
          </section>

          <!-- Init Script -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Init Script</h3>
            <template v-if="container.initScript">
              <pre class="text-xs font-mono text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800 rounded p-2 overflow-x-auto whitespace-pre-wrap">{{ container.initScript }}</pre>
            </template>
            <template v-else>
              <span class="text-xs text-gray-500 dark:text-gray-400 italic">None</span>
            </template>
          </section>

          <!-- Port Mappings -->
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

          <!-- Domain Mappings -->
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

          <!-- App Instances -->
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

          <!-- Exposed Worker APIs -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Exposed Worker APIs</h3>
            <template v-if="exposeApisLabels.length > 0">
              <div class="flex flex-wrap gap-1.5">
                <UBadge v-for="label in exposeApisLabels" :key="label" color="neutral" variant="subtle" size="xs">
                  {{ label }}
                </UBadge>
              </div>
            </template>
            <template v-else>
              <span class="text-xs text-gray-500 dark:text-gray-400 italic">None</span>
            </template>
          </section>

          <!-- Skills -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Skills</h3>
            <template v-if="container.skillNames?.length">
              <div class="flex flex-wrap gap-1.5">
                <UBadge v-for="name in container.skillNames" :key="name" color="neutral" variant="subtle" size="xs">
                  {{ name }}
                </UBadge>
              </div>
            </template>
            <template v-else>
              <span class="text-xs text-gray-500 dark:text-gray-400 italic">None</span>
            </template>
          </section>

          <!-- AGENTS.md -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">AGENTS.md</h3>
            <template v-if="container.agentsMdNames?.length">
              <div class="flex flex-wrap gap-1.5">
                <UBadge v-for="name in container.agentsMdNames" :key="name" color="neutral" variant="subtle" size="xs">
                  {{ name }}
                </UBadge>
              </div>
            </template>
            <template v-else>
              <span class="text-xs text-gray-500 dark:text-gray-400 italic">None</span>
            </template>
          </section>

          <!-- Environment Variables -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Environment Variables</h3>
            <template v-if="container.envVars">
              <pre class="text-xs font-mono text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800 rounded p-2 overflow-x-auto whitespace-pre-wrap">{{ container.envVars }}</pre>
            </template>
            <template v-else>
              <span class="text-xs text-gray-500 dark:text-gray-400 italic">None</span>
            </template>
          </section>

          <!-- Setup Script -->
          <section>
            <h3 class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Setup Script</h3>
            <template v-if="container.setupScript">
              <pre class="text-xs font-mono text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800 rounded p-2 overflow-x-auto whitespace-pre-wrap">{{ container.setupScript }}</pre>
            </template>
            <template v-else>
              <span class="text-xs text-gray-500 dark:text-gray-400 italic">None</span>
            </template>
          </section>
        </div>
      </div>
    </template>
  </UModal>
</template>
