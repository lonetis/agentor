<script setup lang="ts">
import type { ContainerInfo, ChallengeType } from '~/types';

const props = defineProps<{
  containers: ContainerInfo[];
}>();

const { mappings, status, createMappings, removeMapping } = useDomainMappings();

const showForm = ref(false);
const formSubdomain = ref('');
const formProtocols = ref<Set<'http' | 'https' | 'tcp'>>(new Set(['http']));
const formWorkerId = ref('');
const formInternalPort = ref<number | undefined>();
const formBaseDomains = ref<Set<string>>(new Set());
const formAuthEnabled = ref(false);
const formAuthUsername = ref('');
const formAuthPassword = ref('');

const multiDomain = computed(() => status.value.baseDomains.length > 1);

watch(() => status.value.baseDomains, (domains) => {
  if (formBaseDomains.value.size === 0 && domains.length > 0) {
    formBaseDomains.value = new Set([domains[0]!]);
  }
}, { immediate: true });

const runningContainers = computed(() =>
  props.containers.filter((c) => c.status === 'running')
);

function getChallengeType(baseDomain: string): ChallengeType {
  const dc = status.value.baseDomainConfigs.find((c) => c.domain === baseDomain);
  return dc?.challengeType ?? 'none';
}

function getDnsProvider(baseDomain: string): string | undefined {
  const dc = status.value.baseDomainConfigs.find((c) => c.domain === baseDomain);
  return dc?.dnsProvider;
}

const selectedDomainsAllHaveTls = computed(() => {
  if (formBaseDomains.value.size === 0) return false;
  return [...formBaseDomains.value].every((d) => getChallengeType(d) !== 'none');
});

const availableProtocols = computed(() => {
  const hasTls = selectedDomainsAllHaveTls.value;
  return [
    { value: 'http' as const, label: 'http', disabled: false },
    { value: 'https' as const, label: 'https', disabled: !hasTls },
    { value: 'tcp' as const, label: 'tcp', disabled: !hasTls },
  ];
});

function toggleBaseDomain(domain: string) {
  const s = formBaseDomains.value;
  if (s.has(domain)) {
    if (s.size > 1) s.delete(domain);
  } else {
    s.add(domain);
  }
  formBaseDomains.value = new Set(s);
}

function toggleProtocol(value: 'http' | 'https' | 'tcp') {
  const s = formProtocols.value;
  if (value === 'tcp') {
    // TCP is exclusive — selecting it deselects http/https and vice versa
    s.clear();
    s.add('tcp');
  } else {
    s.delete('tcp');
    if (s.has(value)) {
      // Don't allow deselecting the last protocol
      if (s.size > 1) s.delete(value);
    } else {
      s.add(value);
    }
  }
  formProtocols.value = new Set(s);
}

// Reset protocol if it becomes invalid when base domain changes
watch(selectedDomainsAllHaveTls, (hasTls) => {
  if (!hasTls) {
    formProtocols.value.delete('https');
    formProtocols.value.delete('tcp');
    if (formProtocols.value.size === 0) formProtocols.value.add('http');
    formProtocols.value = new Set(formProtocols.value);
  }
});

function resetForm() {
  formSubdomain.value = '';
  formBaseDomains.value = new Set(status.value.baseDomains.length > 0 ? [status.value.baseDomains[0]!] : []);
  formProtocols.value = new Set(['http']);
  formWorkerId.value = '';
  formInternalPort.value = undefined;
  formAuthEnabled.value = false;
  formAuthUsername.value = '';
  formAuthPassword.value = '';
  showForm.value = false;
}

async function handleCreate() {
  if (!formWorkerId.value || !formInternalPort.value || formBaseDomains.value.size === 0 || formProtocols.value.size === 0) return;
  const protocols = [...formProtocols.value];
  const domains = [...formBaseDomains.value];
  const items = domains.flatMap((baseDomain) =>
    protocols.map((protocol) => ({
      subdomain: formSubdomain.value,
      baseDomain,
      protocol,
      workerId: formWorkerId.value,
      internalPort: formInternalPort.value!,
      ...(protocol !== 'tcp' && formAuthEnabled.value && formAuthUsername.value && formAuthPassword.value
        ? { basicAuth: { username: formAuthUsername.value, password: formAuthPassword.value } }
        : {}),
    })),
  );
  await createMappings(items);
  resetForm();
}

const protocolColors: Record<string, string> = {
  http: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300',
  https: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300',
  tcp: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300',
};

const challengeColors: Record<string, string> = {
  none: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  http: 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300',
  dns: 'bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300',
  selfsigned: 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300',
};

function downloadCaCert() {
  window.open('/api/domain-mapper/ca-cert', '_blank');
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Add mapping form -->
    <div v-if="showForm" class="flex flex-col gap-1.5 bg-gray-100 dark:bg-gray-800 rounded p-2 text-xs">
      <div class="flex gap-1.5">
        <div class="flex shrink-0">
          <button
            v-for="p in availableProtocols"
            :key="p.value"
            type="button"
            :disabled="p.disabled"
            class="px-2 py-1 text-xs font-medium border transition-colors first:rounded-l last:rounded-r"
            :class="[
              formProtocols.has(p.value)
                ? 'bg-primary-600 dark:bg-primary-500 text-white border-primary-600 dark:border-primary-500'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600',
              p.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:opacity-80',
            ]"
            :title="p.disabled ? 'No TLS configured' : ''"
            @click="!p.disabled && toggleProtocol(p.value)"
          >
            {{ p.label }}
          </button>
        </div>
        <select
          v-model="formWorkerId"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        >
          <option value="" disabled>Worker</option>
          <option v-for="c in runningContainers" :key="c.id" :value="c.id">
            {{ c.displayName || shortName(c.name) }}
          </option>
        </select>
      </div>
      <div class="flex gap-1.5 items-center">
        <input
          v-model="formSubdomain"
          type="text"
          placeholder="subdomain (optional)"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        />
        <div v-if="multiDomain" class="flex shrink-0">
          <button
            v-for="d in status.baseDomains"
            :key="d"
            type="button"
            class="px-1.5 py-1 text-[10px] font-medium border transition-colors first:rounded-l last:rounded-r"
            :class="[
              formBaseDomains.has(d)
                ? 'bg-primary-600 dark:bg-primary-500 text-white border-primary-600 dark:border-primary-500'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-gray-300 dark:border-gray-600',
            ]"
            :title="`${getChallengeType(d)}${getDnsProvider(d) ? ':' + getDnsProvider(d) : ''}`"
            @click="toggleBaseDomain(d)"
          >
            .{{ d }}
          </button>
        </div>
        <span v-else class="text-gray-400 dark:text-gray-500 text-[10px] shrink-0">.{{ status.baseDomains[0] }}</span>
      </div>
      <div class="flex gap-1.5 items-center">
        <input
          v-model.number="formInternalPort"
          type="number"
          placeholder="Internal port"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        />
      </div>
      <div v-if="!formProtocols.has('tcp')" class="flex flex-col gap-1.5">
        <label class="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 cursor-pointer">
          <input
            v-model="formAuthEnabled"
            type="checkbox"
            class="rounded"
          />
          Basic auth
        </label>
        <div v-if="formAuthEnabled" class="flex gap-1.5">
          <input
            v-model="formAuthUsername"
            type="text"
            placeholder="Username"
            class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
          />
          <input
            v-model="formAuthPassword"
            type="password"
            placeholder="Password"
            class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
          />
        </div>
      </div>
      <div class="flex gap-1.5 justify-end">
        <UButton size="xs" color="neutral" variant="ghost" @click="showForm = false">
          Cancel
        </UButton>
        <UButton size="xs" color="primary" variant="solid" @click="handleCreate">
          Add
        </UButton>
      </div>
    </div>

    <div v-if="!showForm" class="flex gap-1.5 items-center">
      <UButton size="xs" color="primary" variant="solid" @click="showForm = true">
        + Map
      </UButton>
      <UButton
        v-if="status.hasSelfSignedCa"
        size="xs"
        color="neutral"
        variant="ghost"
        title="Download CA certificate (trust in browser for self-signed domains)"
        @click="downloadCaCert"
      >
        <UIcon name="i-lucide-file-down" class="size-3 mr-0.5" />
        CA cert
      </UButton>
    </div>

    <!-- Mappings list -->
    <div v-if="mappings.length === 0 && !showForm" class="text-gray-400 dark:text-gray-500 text-xs text-center py-1">
      No active domain mappings
    </div>
    <div
      v-for="m in mappings"
      :key="m.id"
      class="flex items-center gap-1.5 text-xs bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 min-w-0"
    >
      <span
        class="px-1 rounded text-[10px] font-medium shrink-0"
        :class="protocolColors[m.protocol]"
      >
        {{ m.protocol }}
      </span>
      <span
        class="px-1 rounded text-[10px] shrink-0"
        :class="challengeColors[getChallengeType(m.baseDomain)]"
        :title="getDnsProvider(m.baseDomain) ? `dns:${getDnsProvider(m.baseDomain)}` : getChallengeType(m.baseDomain)"
      >
        {{ getChallengeType(m.baseDomain) === 'dns' ? getDnsProvider(m.baseDomain) : getChallengeType(m.baseDomain) === 'selfsigned' ? 'self' : getChallengeType(m.baseDomain) }}
      </span>
      <span class="text-gray-700 dark:text-gray-300 font-mono truncate min-w-0">{{ m.subdomain ? `${m.subdomain}.${m.baseDomain}` : m.baseDomain }}</span>
      <UIcon
        v-if="m.basicAuth"
        name="i-lucide-lock"
        class="size-3 text-amber-500 shrink-0"
      />
      <span class="text-gray-400 dark:text-gray-600 shrink-0">&rarr;</span>
      <span class="text-gray-500 dark:text-gray-400 truncate min-w-0 flex-1">{{ shortName(m.workerName) }}:{{ m.internalPort }}</span>
      <button
        class="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors shrink-0 p-0.5"
        title="Remove mapping"
        @click="removeMapping(m.id)"
      >
        <UIcon name="i-lucide-x" class="size-3" />
      </button>
    </div>
  </div>
</template>
